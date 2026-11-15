import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { claimWorkspace } from "./workspace";
import "./standalone-ui.css";
import "./tokens.css";
import "./components/JsonPane.css";
import "./app.css";

claimWorkspace(); // a duplicated tab gets its own workspace
createRoot(document.getElementById("root")).render(<App />);
