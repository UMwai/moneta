const PLAID_LINK_SCRIPT =
  "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export interface PlaidInstitutionMetadata {
  institution_id: string;
  name: string;
}

export interface PlaidLinkMetadata {
  institution: PlaidInstitutionMetadata | null;
}

export interface PlaidLinkError {
  display_message?: string | null;
  error_message?: string;
}

export interface PlaidLinkHandler {
  open(): void;
  destroy(): void;
}

interface PlaidLinkOptions {
  token: string;
  onSuccess(
    publicToken: string,
    metadata: PlaidLinkMetadata,
  ): void;
  onExit(error: PlaidLinkError | null): void;
}

interface PlaidLinkGlobal {
  create(options: PlaidLinkOptions): PlaidLinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidLinkGlobal;
  }
}

let loadingScript: Promise<PlaidLinkGlobal> | null = null;

/** Load Plaid's browser SDK only after the user asks to connect a bank. */
export function loadPlaidLink(): Promise<PlaidLinkGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Plaid Link is only available in a browser."));
  }
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (loadingScript) return loadingScript;

  loadingScript = new Promise<PlaidLinkGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PLAID_LINK_SCRIPT}"]`,
    );
    const script = existing ?? document.createElement("script");

    const fail = () => {
      loadingScript = null;
      reject(new Error("Plaid Link could not be loaded. Check this browser's network access."));
    };
    const finish = () => {
      if (!window.Plaid) {
        fail();
        return;
      }
      resolve(window.Plaid);
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });

    if (!existing) {
      script.src = PLAID_LINK_SCRIPT;
      script.async = true;
      document.head.append(script);
    }
  });

  return loadingScript;
}
