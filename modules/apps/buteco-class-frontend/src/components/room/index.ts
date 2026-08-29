// Barrel for the room furniture -- dumb layout/presentational pieces
// shared by AulaRoom and BookClubRoom. Protocol knowledge (sockets,
// WebRTC,commands) lives strictly in the pages.
export { default as RoomShell } from "./RoomShell.js";
export { RoomHeader } from "./RoomHeader.js";
export { RoomStatusBadge } from "./RoomStatusBadge.js";
export { ParticipantsStrip } from "./ParticipantsStrip.js";
export { ChatPanel, type ChatMessage } from "./ChatPanel.js";
export { NotepadPanel } from "./NotepadPanel.js";
export { PanelTabs } from "./PanelTabs.js";
export { RtcErrorBanner } from "./RtcErrorBanner.js";