import { TitleScreen } from "@/components/demo/TitleScreen";
import { staticTitleParams } from "@/lib/connect/catalog";

export function generateStaticParams() {
  return staticTitleParams();
}

export const dynamicParams = false;
export const dynamic = "force-static";

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TitleScreen id={id} />;
}
