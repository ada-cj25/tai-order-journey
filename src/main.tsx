import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import CustomerDemo from "./CustomerDemo.tsx";
import "antd/dist/reset.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith("/customer") ? <CustomerDemo /> : <App />}
  </React.StrictMode>,
);
