import {
  BookOpen,
  Building2,
  Camera,
  ChartPie,
  Clock,
  FileText,
  Handshake,
  House,
  Inbox,
  ListChecks,
  Menu,
  Package,
  Plug,
  Receipt,
  ScanLine,
  Settings2,
  ShoppingBag,
  UserRound,
  Users,
  Wallet,
  type LucideProps,
} from 'lucide-react'

const icons = {
  BookOpen,
  Building2,
  Camera,
  ChartPie,
  Clock,
  FileText,
  Handshake,
  House,
  Inbox,
  ListChecks,
  Menu,
  Package,
  Plug,
  Receipt,
  ScanLine,
  Settings2,
  ShoppingBag,
  UserRound,
  Users,
  Wallet,
}

/** Icon by name, so the navigation list stays plain data. */
export function NavIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = icons[name as keyof typeof icons] ?? House
  return <Icon {...props} />
}
