import WidgetClient from "../../../components/widget-client";
export default async function WidgetPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <WidgetClient publicId={publicId} />;
}
