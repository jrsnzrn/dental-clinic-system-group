export function notifySuccess(message, title = "Success", options = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("topdent:success", {
    detail: { message, title, ...options },
  }));
}
