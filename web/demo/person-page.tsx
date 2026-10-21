import { PersonScreen } from "@/components/demo/PersonScreen";
import { staticPersonParams } from "@/lib/connect/catalog";

export function generateStaticParams() {
  return staticPersonParams();
}

export const dynamicParams = false;
export const dynamic = "force-static";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonScreen id={id} />;
}
