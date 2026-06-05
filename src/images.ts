/**
 * Image capture runs in the home page (extension context). Thanks to the
 * `*.licdn.com` host permission, these fetches are cross-origin-allowed and the
 * response body is readable (page-context fetch would be CORS-blocked, a canvas
 * read would taint). We cache as data URLs so they survive reopens with no
 * signed-URL expiry (m0-plan §8).
 */
export async function fetchAsDataUrl(
  url: string | undefined,
): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
