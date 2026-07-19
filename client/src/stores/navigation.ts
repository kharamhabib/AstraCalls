import { create } from "zustand";

export type NavSection = "dashboard" | "connections" | "calls" | "schedules" | "settings";

type NavigationState = {
  activeSection: NavSection;
  setActiveSection: (section: NavSection) => void;
  agentStatus: "available" | "busy" | "paused";
  setAgentStatus: (status: "available" | "busy" | "paused") => void;
};

export const useNavigation = create<NavigationState>((set) => ({
  activeSection: "dashboard",
  setActiveSection: (section) => set({ activeSection: section }),
  agentStatus: "available",
  setAgentStatus: (status) => set({ agentStatus: status }),
}));
