/* Saha embed: credentials stay inside an isolated frame; the public ID grants no transcript access. */
/* global document, window, URL */
(() => {
  const script = document.currentScript,
    id = script?.getAttribute("data-saha-id");
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return;
  const origin = new URL(script.src).origin;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Chat with us";
  button.setAttribute("aria-label", "Open customer chat");
  Object.assign(button.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483000",
    padding: "14px 20px",
    border: "0",
    borderRadius: "28px",
    background: "#355745",
    color: "#fff",
    font: "600 14px system-ui",
    cursor: "pointer",
    boxShadow: "0 5px 24px #0002",
  });
  const frame = document.createElement("iframe");
  frame.title = "Customer chat";
  frame.src = `${origin}/widget/${id}`;
  frame.referrerPolicy = "origin";
  Object.assign(frame.style, {
    position: "fixed",
    right: "16px",
    bottom: "78px",
    width: "min(390px, calc(100vw - 32px))",
    height: "min(620px, calc(100dvh - 105px))",
    border: "1px solid #dce3d4",
    borderRadius: "16px",
    zIndex: "2147483000",
    boxShadow: "0 10px 50px #0003",
    display: "none",
    background: "#fff",
  });
  button.onclick = () => {
    const open = frame.style.display === "none";
    frame.style.display = open ? "block" : "none";
    button.textContent = open ? "Close chat" : "Chat with us";
    button.setAttribute(
      "aria-label",
      open ? "Close customer chat" : "Open customer chat",
    );
  };
  window.addEventListener("message", (event) => {
    if (
      event.source === frame.contentWindow &&
      event.origin === origin &&
      event.data?.type === "saha:ready" &&
      event.data.publicId === id
    )
      frame.contentWindow.postMessage(
        { type: "saha:init", publicId: id },
        origin,
      );
  });
  const mount = () => {
    document.body.append(button, frame);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
