import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json({
      configured: false,
      connected: false,
      schemaReady: false,
      message: "Supabase environment variables are missing.",
    });
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [clubs, seekers, gacha, areas] = await Promise.all([
    client.from("clubs").select("id").limit(1),
    client.from("seeker_directory").select("id").limit(1),
    client.from("gacha_items").select("id,ticket_type").limit(1),
    client.from("location_areas").select("id").limit(1),
  ]);
  const checks = {
    clubs: clubs.error ? clubs.error.message || clubs.error.code : null,
    seekers: seekers.error ? seekers.error.message || seekers.error.code : null,
    gachaItems: gacha.error ? gacha.error.message || gacha.error.code : null,
    locationAreas: areas.error ? areas.error.message || areas.error.code : null,
  };
  const error = clubs.error || seekers.error || gacha.error || areas.error;

  if (error) {
    return NextResponse.json({
      configured: true,
      connected: true,
      schemaReady: false,
      message: error.message || error.code || "Supabase schema is not ready.",
      checks,
    });
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    schemaReady: true,
    message: "Supabase connected.",
    counts: {
      clubs: clubs.data?.length || 0,
      seekers: seekers.data?.length || 0,
      gachaItems: gacha.data?.length || 0,
      locationAreas: areas.data?.length || 0,
    },
  });
}
