// Archivo: metrics_test.go — Pruebas de las métricas del servidor.
// En español: comprueban que los números que publica /metrics son correctos y que el formato es el
// que Prometheus espera (contadores con _total, histograma con sus cortes y el bucket +Inf, y una
// salida determinista que no cambia de orden entre consultas).
package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestMetricsCountsCallsByProcedureAndCode: cada llamada se cuenta bajo su procedimiento y resultado.
func TestMetricsCountsCallsByProcedureAndCode(t *testing.T) {
	metrics := NewMetrics()

	metrics.ObserveCall("/svc/ListReleases", "ok", 12*time.Millisecond)
	metrics.ObserveCall("/svc/ListReleases", "ok", 30*time.Millisecond)
	metrics.ObserveCall("/svc/ListReleases", "unavailable", 2*time.Second)

	output := metrics.render()

	if !strings.Contains(output, `tsk_rpc_calls_total{procedure="/svc/ListReleases",code="ok"} 2`) {
		t.Fatalf("want two successful calls counted, got:\n%s", output)
	}
	if !strings.Contains(output, `tsk_rpc_calls_total{procedure="/svc/ListReleases",code="unavailable"} 1`) {
		t.Fatalf("want one failed call counted separately, got:\n%s", output)
	}
}

// TestMetricsHistogramIsCumulative: los cortes del histograma son ACUMULATIVOS (cada uno incluye a
// los anteriores) y el bucket "+Inf" siempre vale el total. Es lo que exige el formato de Prometheus.
func TestMetricsHistogramIsCumulative(t *testing.T) {
	metrics := NewMetrics()

	// Una llamada rapidísima y otra lenta.
	metrics.ObserveCall("/svc/Get", "ok", 2*time.Millisecond)
	metrics.ObserveCall("/svc/Get", "ok", 800*time.Millisecond)

	output := metrics.render()

	// El corte de 5 ms solo contiene la rápida.
	if !strings.Contains(output, `le="0.005"} 1`) {
		t.Fatalf("want one call under 5ms, got:\n%s", output)
	}
	// El corte de 1 s contiene las dos (acumulativo).
	if !strings.Contains(output, `le="1"} 2`) {
		t.Fatalf("want both calls under 1s (cumulative buckets), got:\n%s", output)
	}
	// El bucket infinito siempre vale el total observado.
	if !strings.Contains(output, `le="+Inf"} 2`) {
		t.Fatalf("want the +Inf bucket to hold every observation, got:\n%s", output)
	}
	if !strings.Contains(output, `tsk_rpc_duration_seconds_count{procedure="/svc/Get",code="ok"} 2`) {
		t.Fatalf("want the histogram count to be 2, got:\n%s", output)
	}
}

// TestMetricsSeriesOrderIsDeterministic: las series salen SIEMPRE en el mismo orden.
// En español: Go recorre los mapas en orden aleatorio, así que sin ordenar explícitamente cada
// consulta devolvería las líneas barajadas; comparar dos capturas sería imposible porque todo
// parecería haber cambiado. Se compara ignorando el tiempo en marcha, que por su naturaleza sube
// entre una consulta y otra (eso no es indeterminismo, es la métrica haciendo su trabajo).
func TestMetricsSeriesOrderIsDeterministic(t *testing.T) {
	metrics := NewMetrics()
	for _, procedure := range []string{"/svc/C", "/svc/A", "/svc/B"} {
		metrics.ObserveCall(procedure, "ok", time.Millisecond)
	}

	first := linesWithoutUptime(metrics.render())
	second := linesWithoutUptime(metrics.render())
	if first != second {
		t.Fatalf("series order changed between renders.\nfirst:\n%s\nsecond:\n%s", first, second)
	}

	// Además comprobamos el orden concreto: alfabético por procedimiento.
	indexA := strings.Index(first, `procedure="/svc/A"`)
	indexB := strings.Index(first, `procedure="/svc/B"`)
	indexC := strings.Index(first, `procedure="/svc/C"`)
	if indexA >= indexB || indexB >= indexC {
		t.Fatalf("want series sorted by procedure name, got:\n%s", first)
	}
}

// linesWithoutUptime devuelve el texto de métricas quitando la línea del tiempo en marcha, que
// legítimamente cambia entre consultas.
func linesWithoutUptime(rendered string) string {
	var kept []string
	for _, line := range strings.Split(rendered, "\n") {
		if strings.HasPrefix(line, "tsk_uptime_seconds ") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// TestMetricsExposesCatalogHorizon: los días de futuro del catálogo son LA métrica de este producto.
func TestMetricsExposesCatalogHorizon(t *testing.T) {
	metrics := NewMetrics()
	metrics.SetCatalogState(143, 96)

	output := metrics.render()
	if !strings.Contains(output, "tsk_catalog_releases 143") {
		t.Fatalf("want the release count exposed, got:\n%s", output)
	}
	if !strings.Contains(output, "tsk_catalog_days_remaining 96") {
		t.Fatalf("want the catalog horizon exposed, got:\n%s", output)
	}
	if metrics.CatalogDaysRemaining() != 96 {
		t.Fatalf("want CatalogDaysRemaining to report 96, got %d", metrics.CatalogDaysRemaining())
	}
}

// TestMetricsSeparatesRateLimitScopes: los rechazos por cuota se publican separando QUÉ valla los
// produjo, y ambas series existen desde el primer momento aunque valgan cero.
//
// En español: la distinción es lo que hace útil la alarma. Un pico en "api" es casi siempre alguien
// raspando el catálogo en bucle; un pico en "auth" es alguien probando contraseñas. Y las dos líneas
// tienen que existir desde el arranque, porque una serie que no existe no se puede vigilar: quien
// monte una alarma necesita la línea puesta antes del ataque, no que aparezca el día del ataque.
func TestMetricsSeparatesRateLimitScopes(t *testing.T) {
	metrics := NewMetrics()

	// Recién arrancado, las dos series ya están publicadas en cero.
	output := metrics.render()
	for _, scope := range []RateLimitScope{RateLimitScopeAPI, RateLimitScopeAuth} {
		line := `tsk_rate_limited_total{scope="` + string(scope) + `"} 0`
		if !strings.Contains(output, line) {
			t.Fatalf("want the %q series published from the start, got:\n%s", scope, output)
		}
	}

	metrics.ObserveRateLimited(RateLimitScopeAuth)
	metrics.ObserveRateLimited(RateLimitScopeAuth)
	metrics.ObserveRateLimited(RateLimitScopeAPI)

	output = metrics.render()
	if !strings.Contains(output, `tsk_rate_limited_total{scope="auth"} 2`) {
		t.Fatalf("want two auth rejections counted, got:\n%s", output)
	}
	if !strings.Contains(output, `tsk_rate_limited_total{scope="api"} 1`) {
		t.Fatalf("want one api rejection counted, got:\n%s", output)
	}
	if got := metrics.RateLimitedCount(RateLimitScopeAuth); got != 2 {
		t.Fatalf("want RateLimitedCount to report 2 auth rejections, got %d", got)
	}
}

// TestMetricsHandlerServesPrometheusFormat: el endpoint responde 200 con el tipo de contenido correcto.
func TestMetricsHandlerServesPrometheusFormat(t *testing.T) {
	metrics := NewMetrics()
	metrics.ObserveCall("/svc/Get", "ok", time.Millisecond)

	recorder := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200 from the metrics endpoint, got %d", recorder.Code)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/plain") {
		t.Fatalf("want a text/plain content type for Prometheus, got %q", contentType)
	}
	if !strings.Contains(recorder.Body.String(), "# TYPE tsk_rpc_calls_total counter") {
		t.Fatalf("want the Prometheus TYPE headers, got:\n%s", recorder.Body.String())
	}
}
