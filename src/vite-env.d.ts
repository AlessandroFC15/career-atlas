interface ImportMetaEnv {
  readonly VITE_POSTHOG_PROJECT_API_KEY?: string;
  readonly VITE_ANALYTICS_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
