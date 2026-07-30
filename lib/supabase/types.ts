export type ClubRecord = {
  id: string;
  display_name: string;
  search_name: string;
  kana_name?: string | null;
  store_code: string | null;
  business_type: string;
  region: string;
  area: string;
  appeal_text: string | null;
  logo_url: string | null;
  instagram_url?: string | null;
  interior_photo_urls: string[];
  profile?: Record<string, unknown> | null;
  updated_at?: string | null;
};

export type SeekerRecord = {
  id: string;
  user_id?: string | null;
  line_user_id?: string | null;
  line_picture_url?: string | null;
  nickname: string;
  age: number;
  region: string;
  area: string;
  experience: string;
  desired_shift: string;
  start_timing: string;
  photo_1_url: string | null;
  photo_2_url: string | null;
  full_body_photo_url: string | null;
  created_at: string;
  offer_count?: number;
  last_call_cast?: boolean;
  past_offers?: {
    id: string;
    club_id?: string | null;
    club_name?: string | null;
    club_logo_url?: string | null;
    created_at: string;
    hourly_wage: number;
    guarantee_period: string;
    comment: string | null;
    status: "interested" | "rejected" | "no_response" | "sent";
    response_status?: string | null;
    next_action?: string | null;
    selected_date?: string | null;
    offered_hourly_wage?: number | null;
    response_source?: string | null;
  }[];
};

export type OfferRecord = {
  id: string;
  club: string;
  area: string;
  wage: number;
  period: string;
  note: string;
  logo: string;
  status: "new" | "interested" | "rejected";
  response_status?: string | null;
  next_action?: string | null;
  selected_date?: string | null;
  cancel_reason?: string | null;
};

export type AdminOfferRecord = {
  id: string;
  bubble_id: string | null;
  club_name: string | null;
  seeker_name: string | null;
  area: string | null;
  hourly_wage: number;
  guarantee_period: string;
  comment: string | null;
  status: "sent" | "interested" | "rejected";
  is_test: boolean;
  created_at: string;
  response_status?: string | null;
  next_action?: string | null;
  selected_date?: string | null;
  response_source?: string | null;
};

export type GachaItemRecord = {
  id?: string;
  name: string;
  rarity: string;
  description: string;
  image_url?: string;
  probability?: number;
  ticket_type?: "registration_invite" | "interview";
};

export type AdminGachaResultRecord = {
  id: string;
  bubble_id: string | null;
  user_name: string;
  item_name: string;
  rarity: string;
  used_status: "unused" | "requested" | "completed";
  is_test: boolean;
  created_at: string;
};

export type GachaState = {
  registration_invite: number;
  interview: number;
  results: GachaItemRecord[];
  rank?: string;
};

export type SeekerProfileInput = {
  nickname: string;
  fullName?: string;
  age: number;
  workExperience: string;
  desiredRegion: string;
  desiredArea: string;
  desiredShift: string;
  startTiming: string;
  currentRegion: string;
  currentArea: string;
  currentClubId?: string;
  blockedClubIds: string[];
  currentHourlyRange: string;
  currentMonthlySalesRange: string;
  photo1Url?: string;
  photo2Url?: string;
  photo3Url?: string;
  desiredClubIds?: string[];
  referralCode?: string;
};

export type SeekerProfileRecord = {
  nickname: string;
  full_name?: string;
  age: number;
  work_experience: string;
  desired_region: string;
  desired_area: string;
  desired_shift: string;
  start_timing: string;
  current_region: string | null;
  current_area: string | null;
  current_club: string | null;
  current_club_id?: string | null;
  blocked_clubs: string[];
  blocked_club_ids?: string[];
  current_hourly_range: string | null;
  current_monthly_sales_range: string | null;
  photo_1_url: string | null;
  photo_2_url: string | null;
  full_body_photo_url: string | null;
  invite_code: string;
  desired_club_ids?: string[];
  rank?: string;
};
