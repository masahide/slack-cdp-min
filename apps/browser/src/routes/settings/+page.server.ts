import { getDefaultClipboardTemplate, loadClipboardTemplate } from "$lib/server/clipboardTemplate";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const active = await loadClipboardTemplate();
  return {
    clipboardTemplate: {
      source: active.source,
      origin: active.origin,
      path: active.path,
      defaultSource: getDefaultClipboardTemplate(),
    },
  };
};
