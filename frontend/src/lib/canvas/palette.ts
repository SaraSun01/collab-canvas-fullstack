export interface ComponentSpec {
  type: string;
  label: string;
  description: string;
  category: string;
  width: number;
  height: number;
  color: "neutral" | "accent" | "amber" | "rose";
}

export const COMPONENT_CATEGORIES = [
  "General",
  "Data",
  "Messaging",
  "Network",
  "Compute",
  "AI",
] as const;

export const COMPONENT_LIBRARY: ComponentSpec[] = [
  // General
  { type: "service", label: "Service", description: "process", category: "General", width: 150, height: 68, color: "neutral" },
  { type: "rounded", label: "Component", description: "", category: "General", width: 150, height: 68, color: "neutral" },
  { type: "boundary", label: "Boundary", description: "group", category: "General", width: 260, height: 180, color: "neutral" },
  { type: "generic", label: "Generic", description: "", category: "General", width: 130, height: 64, color: "neutral" },
  // Data
  { type: "sql", label: "Relational DB", description: "postgres", category: "Data", width: 150, height: 68, color: "accent" },
  { type: "nosql", label: "NoSQL DB", description: "documents", category: "Data", width: 150, height: 68, color: "accent" },
  { type: "cache", label: "Cache", description: "redis", category: "Data", width: 140, height: 68, color: "accent" },
  { type: "blob", label: "Object Storage", description: "files", category: "Data", width: 150, height: 68, color: "accent" },
  { type: "warehouse", label: "Data Warehouse", description: "analytics", category: "Data", width: 160, height: 68, color: "accent" },
  // Messaging
  { type: "queue", label: "Queue", description: "fifo", category: "Messaging", width: 140, height: 68, color: "amber" },
  { type: "stream", label: "Event Stream", description: "topic", category: "Messaging", width: 150, height: 68, color: "amber" },
  { type: "pubsub", label: "Pub/Sub Broker", description: "fan-out", category: "Messaging", width: 155, height: 68, color: "amber" },
  // Network
  { type: "client", label: "Client", description: "web / mobile", category: "Network", width: 140, height: 68, color: "neutral" },
  { type: "gateway", label: "API Gateway", description: "auth · routing", category: "Network", width: 155, height: 68, color: "neutral" },
  { type: "lb", label: "Load Balancer", description: "round robin", category: "Network", width: 155, height: 68, color: "neutral" },
  { type: "cdn", label: "CDN", description: "edge cache", category: "Network", width: 130, height: 68, color: "neutral" },
  { type: "external", label: "External API", description: "third party", category: "Network", width: 150, height: 68, color: "rose" },
  // Compute
  { type: "server", label: "Server", description: "app tier", category: "Compute", width: 145, height: 68, color: "neutral" },
  { type: "worker", label: "Worker", description: "async jobs", category: "Compute", width: 145, height: 68, color: "neutral" },
  { type: "function", label: "Function", description: "serverless", category: "Compute", width: 145, height: 68, color: "neutral" },
  { type: "cluster", label: "Container Cluster", description: "k8s", category: "Compute", width: 165, height: 68, color: "neutral" },
  // AI
  { type: "llm", label: "LLM", description: "model", category: "AI", width: 140, height: 68, color: "rose" },
  { type: "embedding", label: "Embedding Model", description: "vectors", category: "AI", width: 165, height: 68, color: "rose" },
  { type: "vectordb", label: "Vector DB", description: "ann index", category: "AI", width: 150, height: 68, color: "rose" },
  { type: "agent", label: "Agent", description: "tools", category: "AI", width: 140, height: 68, color: "rose" },
];

export function findComponent(type: string): ComponentSpec | undefined {
  return COMPONENT_LIBRARY.find((c) => c.type === type);
}
