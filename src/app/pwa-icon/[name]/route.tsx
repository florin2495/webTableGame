import { renderIcon } from "@/lib/pwa-icon";

const ICONS: Record<string, { px: number; inset: number }> = {
  "192.png": { px: 192, inset: 0 },
  "512.png": { px: 512, inset: 0 },
  // Maskable: board (incl. its brown frame) sits inside the central 80% safe zone.
  "maskable-512.png": { px: 512, inset: 0.12 },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const icon = ICONS[name];
  if (!icon) return new Response("Not found", { status: 404 });
  return renderIcon(icon.px, icon.inset);
}
