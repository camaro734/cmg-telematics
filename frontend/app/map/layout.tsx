import AppShell from "@/components/AppShell";
export default function MapLayout({ children }: { children: React.ReactNode }) {
  return <AppShell overflow="hidden">{children}</AppShell>;
}
