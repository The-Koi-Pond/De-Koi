import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { App } from "./App";
import { GlobalErrorBoundary, installGlobalErrorDiagnostics, reportReactRootError } from "./GlobalErrorBoundary";
import "../styles/globals.css";
import { apiQueryRetryDelay, shouldRetryApiQuery } from "../shared/api/query-retry";
import { markPerformanceMilestone } from "../shared/lib/performance-diagnostics";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      staleTime: 30_000,
      retry: shouldRetryApiQuery,
      retryDelay: apiQueryRetryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});

installGlobalErrorDiagnostics();
markPerformanceMilestone("app.boot");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onCaughtError: (error, errorInfo) => reportReactRootError("caught", error, errorInfo),
  onUncaughtError: (error, errorInfo) => reportReactRootError("uncaught", error, errorInfo),
  onRecoverableError: (error, errorInfo) => reportReactRootError("recoverable", error, errorInfo),
}).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <GlobalErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </GlobalErrorBoundary>
    </MotionConfig>
  </React.StrictMode>,
);
