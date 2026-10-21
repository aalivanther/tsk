"use client";

// Archivo: ReleaseModal.tsx — MODAL de detalle COMPLETO de un título (sagas/relacionados).
//
// En español: cuando el usuario pulsa una tarjeta de "Conexiones" o una entrada de la saga que SÍ
// existe en el catálogo, en vez de navegar (perder el contexto) abrimos este modal con la FICHA RICA
// completa (el mismo ReleaseDetail de siempre: tráiler, sinopsis, calendario, reparto, etc.). El modal
// COEXISTE con la página de título: arriba lleva un enlace "Ver página completa" hacia /titulo/[id]
// para quien quiera la URL compartible.
//
// DE DÓNDE SALE LA FICHA, que es lo que cambió: este modal recibe el RESUMEN del título (lo que el
// catálogo de la pantalla conoce de él: su título, su fecha, su carátula) y PIDE la ficha completa al
// abrirse. Antes la recibía ya cargada, porque la lista de estrenos traía las fichas completas de los
// trescientos y pico títulos de la ventana — y eso era el grueso del peso de la página de inicio.
//
// Mientras la ficha viene en camino se enseña una silueta con el título de verdad escrito arriba, de
// modo que la persona siempre sabe qué está abriendo y la pantalla nunca se queda en blanco. Si no
// llega, un aviso con su reintento. En cuanto llega una vez, se recuerda: volver a abrir ese mismo
// título es instantáneo (ver lib/connect/release-detail.ts).
//
// El contenido se puede ENCADENAR sin apilar modales: el ReleaseDetail interno recibe onOpenRelease,
// así que pulsar un relacionado DENTRO del modal REEMPLAZA la ficha mostrada (una sola capa, siempre).
// Cierre accesible: botón ✕, clic en el velo y tecla Escape. Va por PORTAL a document.body para
// escapar de cualquier ancestro con overflow/backdrop-filter que lo recorte.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Link from "next/link";

import { DetailErrorNotice, DetailSkeleton } from "@/components/DetailPending";
import { ReleaseDetail } from "@/components/ReleaseDetail";
import { useReleaseDetail } from "@/lib/connect/release-detail";
import { useDialogEscape } from "@/lib/dialog-stack";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ui } from "@/lib/i18n";
import { findConnections, isUpcoming, type TodayMarker } from "@/lib/timeline";
import { type ReleaseSummary } from "@/gen/mdm7mo/catalog/v1/catalog_pb";

// ReleaseModalProps son las props del modal de detalle completo.
type ReleaseModalProps = {
  // summary es el RESUMEN del título cuya ficha se abre al montar el modal.
  summary: ReleaseSummary;
  // catalog es el catálogo cargado en su forma ligera (para derivar conexiones y encadenar fichas).
  catalog: ReleaseSummary[];
  // today es el marcador HOY (para "Próximamente" y el calendario de emisión). Opcional.
  today?: TodayMarker;
  // onClose cierra el modal (botón ✕, velo o Escape).
  onClose: () => void;
};

// ReleaseModal dibuja el velo + la tarjeta scrolleable con la ficha completa del título actual.
export function ReleaseModal({ summary, catalog, today, onClose }: ReleaseModalProps) {
  // current es el título MOSTRADO ahora: arranca en el recibido y se REEMPLAZA al pulsar relacionados
  // dentro del modal (encadenado en una sola capa, sin apilar diálogos).
  const [current, setCurrent] = useState<ReleaseSummary>(summary);
  // Si el padre abre OTRO título (summary cambia), el modal muestra el nuevo desde arriba. Es el patrón
  // "estado derivado de una prop" documentado por React: comparar contra la última prop vista y ajustar
  // DURANTE el render (no en un efecto), que re-renderiza de inmediato sin pintar el estado viejo.
  const [lastOpened, setLastOpened] = useState<ReleaseSummary>(summary);
  if (summary !== lastOpened) {
    setLastOpened(summary);
    setCurrent(summary);
  }

  // La ficha completa del título mostrado, pedida al backend en cuanto se abre (o recordada si ya se
  // trajo antes). De aquí salen el tráiler, el reparto, la galería, el calendario y la saga.
  const {
    release: detail,
    loading: detailLoading,
    error: detailError,
    retry: retryDetail,
  } = useReleaseDetail(current.id);

  // Al cambiar de ficha, el scroll de la tarjeta vuelve arriba (la ficha nueva empieza desde su héroe).
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    cardRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [current.id]);

  // Cierre con Escape vía la PILA COMPARTIDA de diálogos: si este modal está encima de otra capa (el
  // Stage), Escape cierra SOLO este modal; la capa de abajo queda intacta para la siguiente pulsación.
  useDialogEscape(true, onClose);

  // Trampa de foco propia (el modal vive en un portal, fuera de la trampa del Stage): foco inicial al
  // abrir, Tab contenido dentro del diálogo y retorno del foco al cerrar.
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  // Conexiones reales de la ficha mostrada, derivadas del catálogo ligero (misma receta que la página).
  // Se calculan con el RESUMEN, que ya trae los datos deducidos que hacen falta (nombre de la saga,
  // dirección y reparto principal), así que no dependen de que la ficha completa haya llegado.
  const related = findConnections(current, catalog);
  const upcoming = today !== undefined ? isUpcoming(current, today) : false;

  // SSR-safe: el portal solo existe en el navegador (document). En el servidor no se monta nada.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={trapRef}
      className="rf-release-modal"
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
      tabIndex={-1}
      onClick={onClose}
    >
      {/* Tarjeta scrolleable: detiene la propagación para que el clic DENTRO no cierre (solo el velo). */}
      <div
        ref={cardRef}
        className="rf-release-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Barra superior del modal: enlace a la página completa + cerrar. Siempre visible (sticky). */}
        <div className="rf-release-modal-bar">
          <Link
            href={`/titulo/${current.id}`}
            className="rf-release-modal-link font-mono"
            onClick={onClose}
          >
            {ui.detail.openFullPage}
            <span aria-hidden="true"> →</span>
          </Link>
          <button
            type="button"
            className="rf-release-modal-close"
            onClick={onClose}
            aria-label={ui.detail.modalClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/*
          La ficha rica completa, cuando ya llegó. onOpenRelease REEMPLAZA la ficha (encadenado en una
          sola capa). Mientras viene en camino se enseña la silueta con el título real escrito; si no
          llegó, el aviso con su reintento. En los tres casos la barra de arriba sigue en su sitio, así
          que cerrar o ir a la página completa nunca deja de estar disponible.
        */}
        {detail !== null ? (
          <ReleaseDetail
            release={detail}
            related={related}
            upcoming={upcoming}
            today={today}
            catalog={catalog}
            onOpenRelease={setCurrent}
          />
        ) : detailLoading ? (
          <DetailSkeleton title={current.title} extraClassName="rf-release-modal-pending" />
        ) : (
          <DetailErrorNotice
            message={detailError ?? ui.detail.notFoundHint}
            onRetry={retryDetail}
            extraClassName="rf-release-modal-pending"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
