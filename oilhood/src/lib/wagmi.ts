import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { robinhood } from "viem/chains";
import { site } from "@/config/site";

export { robinhood };

export const wagmiConfig = createConfig({
  chains: [robinhood],
  connectors: [
    injected(),
    ...(site.walletConnectProjectId
      ? [walletConnect({ projectId: site.walletConnectProjectId, showQrModal: true })]
      : []),
  ],
  transports: { [robinhood.id]: http() },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
