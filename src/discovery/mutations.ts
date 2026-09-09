export interface DiscoveryMutation {
  name: string;
  description: string;
  apply: Record<string, string>;
  remove?: string[];
  removeEnv?: string[];
}

export const SAFE_DISCOVERY_MUTATIONS: DiscoveryMutation[] = [
  {
    name: "empty-workspace",
    description: "Run in an empty workspace",
    apply: {}
  },
  {
    name: "remove-config-dir",
    description: "Remove the .acme config directory",
    apply: {},
    remove: [".acme"]
  },
  {
    name: "remove-config-file",
    description: "Remove the .acme/config.json file",
    apply: {},
    remove: [".acme/config.json"]
  },
  {
    name: "corrupt-config-json",
    description: "Replace config.json with invalid JSON",
    apply: { ".acme/config.json": "{ this is not valid json,,," }
  },
  {
    name: "missing-token-env",
    description: "Unset the API_TOKEN environment variable",
    apply: {},
    removeEnv: ["API_TOKEN"]
  }
];
