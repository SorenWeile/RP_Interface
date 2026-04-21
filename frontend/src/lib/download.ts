/**
 * Download a URL as a file via fetch → blob → objectURL.
 *
 * Using <a href download> from an Electron file:// page to an http:// server
 * opens the OS save dialog but then silently fails to complete the transfer.
 * Fetching the bytes ourselves and creating a blob URL sidesteps that restriction.
 */
export async function fetchAndDownload(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.click()
  // Revoke after a tick so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
