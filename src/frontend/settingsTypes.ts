export type ProfileInput = {
  revision: number;
  relationship_tier: 'New' | 'Regular' | 'Key';
  preferred_channel: 'Email' | 'WhatsApp';
  language: 'English' | 'Bahasa Malaysia';
  tone: 'Friendly' | 'Neutral' | 'Firm';
  do_not_contact: boolean;
};
export type Profile = ProfileInput & {
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  grace_days: number;
};
export type RulesInput = {
  revision: number;
  grace_days_by_tier: Record<'New' | 'Regular' | 'Key', number>;
  alert_threshold: string;
  safety_flag_days: number;
  min_spacing_days: number;
  skip_holidays: boolean;
  second_approval_amount: string;
};
