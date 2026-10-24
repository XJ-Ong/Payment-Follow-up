import {
  Activity,
  FileClock,
  FileText,
  LayoutDashboard,
  ListTodo,
  Send,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { InvoiceScope } from './model';

export type Page =
  | 'Follow-ups'
  | 'Reminder Workflow'
  | 'Dashboard'
  | 'Today’s Queue'
  | 'Invoices & Payments'
  | 'Customer Profiles'
  | 'Rules & Settings'
  | 'Weekly Summary'
  | 'Activity Log'
  | 'Simulated Outbox';

type NavigationItem = { label: Page; icon: LucideIcon; group?: boolean };

export const navigation: NavigationItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Follow-ups', icon: ListTodo },
  { label: 'Today’s Queue', icon: ListTodo },
  { label: 'Reminder Workflow', icon: FileText },
  { label: 'Invoices & Payments', icon: FileText },
  { label: 'Customer Profiles', icon: Users },
  { label: 'Rules & Settings', icon: Settings2 },
  { label: 'Weekly Summary', icon: FileClock, group: true },
  { label: 'Activity Log', icon: Activity },
  { label: 'Simulated Outbox', icon: Send },
];

export function getInvoiceScope(page: Page, databaseMode = false): InvoiceScope {
  if (databaseMode && page === 'Dashboard') return 'ranked';
  if (databaseMode && page.includes('Queue')) return 'queue';
  if (page === 'Today’s Queue') return 'review';
  if (page === 'Simulated Outbox') return 'sent';
  return 'all';
}
