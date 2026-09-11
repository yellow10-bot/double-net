import { supabase } from "./supabaseClient";

// Real file storage now (Supabase Storage) instead of the old base64-in-JSON
// trick, so the size cap is much more generous -- 5MB instead of ~900KB.
export const MAX_IMAGE_BYTES = 5_000_000;

export async function uploadImage(file, folder) {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("That photo is too large — pick one under 5MB.");
  }
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("photos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data.publicUrl;
}
