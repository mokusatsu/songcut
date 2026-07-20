import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeRendererI18n } from "./i18n";
import "./styles.css";

async function render() {
  const locale = await window.songcut.getLocaleSettings();
  await initializeRendererI18n(locale.language);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App initialLocaleSettings={locale} />
    </React.StrictMode>
  );
}

void render();
