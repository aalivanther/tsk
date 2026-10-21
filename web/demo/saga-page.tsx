import { SagaScreen } from "@/components/demo/SagaScreen";
import { staticSagaParams } from "@/lib/connect/catalog";

export function generateStaticParams() {
  return staticSagaParams();
}

export const dynamicParams = false;
export const dynamic = "force-static";

export default async function SagaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SagaScreen id={id} />;
}
