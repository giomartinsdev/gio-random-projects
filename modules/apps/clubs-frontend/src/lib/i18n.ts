// i18n do FC Clubs Hub — 5 idiomas, sem dependência externa.
//
// Por que sem biblioteca: o app tem ~60 strings e o repo inteiro não usa i18n
// em nenhum outro frontend. Um `Record` tipado dá autocomplete, faz o
// compilador cobrar tradução faltando (o tipo `Dict` obriga a ter todas as
// chaves em todos os idiomas) e não soma dependência por 60 frases.
//
// O idioma vive em localStorage e cai para o do navegador. `en-US` é o padrão
// global -- se o navegador não fala nenhum dos cinco, o app abre em inglês.

import { useCallback, useEffect, useState } from "react";

export const LOCALES = ["en-US", "pt-BR", "es-ES", "fr-FR", "from_division-DE"] as const;
export type Locale = (typeof LOCALES)[number];

/** O idioma como aparece para quem escolhe. */
export const LOCALE_LABEL: Record<Locale, string> = {
  "en-US": "English (US)",
  "pt-BR": "Português (BR)",
  "es-ES": "Español",
  "fr-FR": "Français",
  "from_division-DE": "Deutsch",
};

/** Bandeira/abreviação curta para o seletor compacto. */
export const LOCALE_SHORT: Record<Locale, string> = {
  "en-US": "EN",
  "pt-BR": "PT",
  "es-ES": "ES",
  "fr-FR": "FR",
  "from_division-DE": "DE",
};

/** Chaves em inglês (o código é em inglês; a chave descreve a intenção). */
export type Key =
  | "nav.discover" | "nav.myHub" | "nav.system"
  | "nav.home" | "nav.clubs" | "nav.players" | "nav.claim"
  | "nav.myArea" | "nav.notifications" | "nav.admin"
  | "action.signIn" | "action.signOut" | "action.connect" | "action.connecting"
  | "action.save" | "action.saving" | "action.saved" | "action.search"
  | "action.loading" | "action.back" | "action.clear"
  | "brand.tagline" | "brand.connecting"
  | "common.player" | "common.players" | "common.club" | "common.clubs"
  | "common.match" | "common.matches" | "common.goals" | "common.assists"
  | "common.rating" | "common.played" | "common.points" | "common.level"
  | "common.division" | "common.position" | "common.esc" | "common.rank"
  | "common.standing" | "common.redCards" | "common.season" | "common.career"
  | "common.tracked" | "common.notTracked" | "common.selected" | "common.noData"
  | "common.noMatches" | "common.youFollow" | "common.uniquePerAccount"
  | "common.inferred" | "common.when" | "common.result" | "common.min"
  | "common.pos" | "common.index" | "common.history"
  | "home.title" | "home.subtitle" | "home.feed" | "home.feedEmpty"
  | "home.feedEmptyHint" | "home.levelByClub" | "home.levelEmpty"
  | "home.levelEmptyHint" | "home.globalRanking" | "home.rankingFailed" | "home.noClubs"
  | "home.noClubsHint" | "home.metric.level" | "home.metric.points"
  | "home.metric.goals" | "home.metric.cleanSheets" | "home.metric.rating"
  | "home.metric.assists" | "home.metric.goalsPerGame"
  | "login.title" | "login.subtitle" | "login.signInTitle" | "login.noSignup"
  | "login.perk1" | "login.perk1Hint" | "login.perk2" | "login.perk2Hint"
  | "login.perk3" | "login.perk3Hint" | "login.perk4" | "login.perk4Hint"
  | "claim.title" | "claim.subtitle" | "claim.step1" | "claim.step1Hint"
  | "claim.step2" | "claim.step2Hint" | "claim.step3" | "claim.step3Hint"
  | "claim.stepOf" | "claim.findClub" | "claim.findClubHint"
  | "claim.found" | "claim.searching" | "claim.searchingHint"
  | "claim.liveSearch" | "claim.liveSearchHint" | "claim.notFound"
  | "claim.notFoundLive" | "claim.notFoundHint" | "claim.howItWorks"
  | "claim.howItWorksSub" | "claim.how1" | "claim.how1Hint"
  | "claim.how2" | "claim.how2Hint" | "claim.how3" | "claim.how3Hint"
  | "claim.tipTitle" | "claim.tipHint" | "claim.choosePlayer"
  | "claim.choosePlayerHint" | "claim.squad" | "claim.fetchingSquad"
  | "claim.filterPlayer" | "claim.all" | "claim.noPlayers"
  | "claim.noPlayersHint" | "claim.confirmTitle" | "claim.confirmHint"
  | "claim.claimThis" | "claim.claiming" | "claim.signInToClaim"
  | "claim.signInToClaimHint" | "claim.claimed" | "claim.verified"
  | "claim.yourPro" | "claim.selectPlayer" | "claim.selectPlayerHint"
  | "claim.changeClub" | "claim.doneTitle" | "claim.doneSubtitle"
  | "claim.discovering" | "claim.discoveringHint" | "claim.youPlayHere"
  | "claim.rivals" | "claim.rivalsHint" | "claim.rivalsOfRivals"
  | "claim.rivalsOfRivalsHint" | "claim.progress" | "claim.nextStep"
  | "claim.nextTitle" | "claim.next1" | "claim.next1Hint"
  | "claim.next2" | "claim.next2Hint" | "claim.next3" | "claim.next3Hint"
  | "claim.goMyArea" | "claim.viewMyClub" | "claim.claimAnother"
  | "claim.failed" | "claim.saveHint" | "claim.sourceRefused"
  | "club.notTrackedTitle" | "club.notTrackedHint" | "club.squad"
  | "club.cleanSheets" | "club.attack" | "club.defense" | "club.form"
  | "club.matchesTab" | "club.statsTab" | "club.summaryTab" | "club.squadTab"
  | "club.recordBook" | "club.divisionByReading" | "club.recentMatches"
  | "club.opponents" | "club.kits" | "club.crest" | "club.stadium"
  | "club.bestDivision" | "club.promotions" | "club.relegations"
  | "club.biggestWin" | "club.worstLoss" | "club.highestScoring"
  | "club.bestRating" | "club.mostGoalsInMatch" | "club.overallIndex"
  | "player.form" | "player.season" | "player.ratingAvg"
  | "player.goalsPerGame" | "player.assistsPerGame" | "player.motm"
  | "player.passAccuracy" | "player.tackleAccuracy" | "player.keeperSaves"
  | "player.keeperHint" | "player.clubsPlayedAt" | "player.clubsHint"
  | "player.lastAppearances" | "player.publicProfile" | "player.careerAt"
  | "players.title" | "players.subtitle" | "players.searchHint"
  | "notif.title" | "notif.subtitle" | "notif.channel" | "notif.notConfigured"
  | "notif.messagesGoHere" | "notif.nothingSent" | "notif.channelConfigured"
  | "notif.noChannel" | "notif.whatToReceive" | "notif.weekly"
  | "notif.weeklyHint" | "notif.records" | "notif.recordsHint"
  | "notif.results" | "notif.resultsHint" | "notif.discordTitle"
  | "notif.discordHint" | "notif.preview" | "notif.previewTitle"
  | "notif.previewBody" | "notif.previewHint" | "notif.leaveBlank"
  | "area.title" | "area.subtitle" | "area.clubsYouFollow"
  | "area.trackedAutomatically" | "area.syncStatus" | "area.inProgress"
  | "area.upToDate" | "area.nothingPending" | "area.unlockedClubs"
  | "area.rivalsAndRivals" | "area.yourPro" | "area.notClaimed"
  | "area.sync" | "area.workingBg" | "area.now" | "area.youDontWait"
  | "area.noneFollowed" | "area.noneFollowedHint" | "area.whatLoginBrought"
  | "area.yourClubs" | "area.whereYouPlay" | "area.directRivals"
  | "area.recentOpponents" | "area.clubsOfClubs" | "area.rivalsOfRivals"
  | "area.nothingHere" | "area.viewProfile" | "area.updateClubs"
  | "admin.title" | "admin.subtitle" | "admin.restricted"
  | "admin.restrictedHint" | "admin.overview" | "admin.integration"
  | "admin.rankings" | "admin.pipeline" | "admin.normalization"
  | "admin.generalStatus" | "admin.clubsTracked" | "admin.matches"
  | "admin.players" | "admin.snapshots" | "admin.announcements"
  | "admin.divisionChanges" | "admin.lastMatch" | "admin.byDivision"
  | "admin.topClubs" | "admin.ingestHealth" | "admin.cycles"
  | "admin.clubsOk" | "admin.clubsFailed" | "admin.newMatches"
  | "admin.bootstrapped" | "admin.alive" | "admin.lastCycle"
  | "admin.lastError" | "admin.never"
  | "sync.sync" | "sync.syncing" | "sync.sourceRefused";

type Dict = Record<Key, string>;

const en_US: Dict = {
  "nav.discover": "Explore", "nav.myHub": "My Hub", "nav.system": "System",
  "nav.home": "Home", "nav.clubs": "Clubs", "nav.players": "Players",
  "nav.claim": "Claim pro", "nav.myArea": "My area", "nav.notifications": "Notifications",
  "nav.admin": "Admin",
  "action.signIn": "Sign in with Google", "action.signOut": "Sign out",
  "action.connect": "Connect", "action.connecting": "Checking session…",
  "action.save": "Save", "action.saving": "Saving…", "action.saved": "Saved",
  "action.search": "Search", "action.loading": "Loading…", "action.back": "Back",
  "action.clear": "clear",
  "brand.tagline": "rankings · history", "brand.connecting": "checking…",
  "common.player": "player", "common.players": "players", "common.club": "club",
  "common.clubs": "clubs", "common.match": "match", "common.matches": "matches",
  "common.goals": "goals", "common.assists": "assists", "common.rating": "rating",
  "common.played": "played", "common.points": "points", "common.level": "level",
  "common.division": "division", "common.position": "position",
  "common.esc": "esc", "common.rank": "rank", "common.standing": "standing",
  "common.redCards": "red cards", "common.season": "Season", "common.career": "career",
  "common.tracked": "tracked", "common.notTracked": "not tracked",
  "common.selected": "selected", "common.noData": "no data yet",
  "common.noMatches": "no matches", "common.youFollow": "you follow",
  "common.uniquePerAccount": "unique per account", "common.inferred": "inferred by correlation",
  "common.when": "when", "common.result": "result", "common.min": "min",
  "common.pos": "pos", "common.index": "index", "common.history": "history",
  "home.title": "Arena",
  "home.subtitle": "Rankings, matches and the history EA doesn't keep. All open — sign in only if you want to follow your clubs.",
  "home.feed": "Arena feed", "home.feedEmpty": "No announcements yet",
  "home.feedEmptyHint": "The feed is generated from the results the hub follows. As soon as there are matches, they show up here.",
  "home.levelByClub": "Level by club", "home.levelEmpty": "no data yet",
  "home.levelEmptyHint": "Once the hub accumulates clubs, the chart appears.",
  "home.globalRanking": "Global ranking",
  "home.rankingFailed": "Couldn't load the ranking", "home.noClubs": "No clubs in the ranking yet",
  "home.noClubsHint": "The hub starts empty and grows as it follows clubs.",
  "home.metric.level": "Level", "home.metric.points": "Points",
  "home.metric.goals": "Goals", "home.metric.cleanSheets": "Clean sheets",
  "home.metric.rating": "Rating", "home.metric.assists": "Assists",
  "home.metric.goalsPerGame": "Goals/game",
  "login.title": "My area",
  "login.subtitle": "The hub works without signing in. Once you do, it discovers your clubs, their rivals and their rivals' rivals — and brings everything on its own, in the background.",
  "login.signInTitle": "Sign in with Google",
  "login.noSignup": "No signup and no new password: we use the same login as the rest of the hub. Leave whenever you want.",
  "login.perk1": "Explore clubs, players and matches", "login.perk1Hint": "this already works without signing in",
  "login.perk2": "Follow clubs and build your list", "login.perk2Hint": "pick the ones that interest you",
  "login.perk3": "Your clubs updated on their own", "login.perk3Hint": "the hub works in the background",
  "login.perk4": "Discord notifications whenever you want", "login.perk4Hint": "you choose what to receive",
  "claim.title": "Claim my pro",
  "claim.subtitle": "Find your club, choose your player and the hub starts following your clubs, their rivals and their rivals' rivals — on its own.",
  "claim.step1": "Find club", "claim.step1Hint": "search by name",
  "claim.step2": "Choose player", "claim.step2Hint": "you mark yours",
  "claim.step3": "Done", "claim.step3Hint": "hub follows on its own",
  "claim.stepOf": "STEP 1 OF 3", "claim.findClub": "What's your club?",
  "claim.findClubHint": "Type the name. Search ignores accents and case.",
  "claim.found": "clubs found for", "claim.searching": "searching…",
  "claim.searchingHint": "type at least 2 characters",
  "claim.liveSearch": "Looking at the source…",
  "claim.liveSearchHint": "The hub didn't know this club, so we searched the source. It takes a few seconds — no need to reload.",
  "claim.notFound": "No club found",
  "claim.notFoundLive": "The source didn't return this club either. Check the exact name — try the tag.",
  "claim.notFoundHint": "Try part of the name or the club tag.",
  "claim.howItWorks": "How it works", "claim.howItWorksSub": "The hub follows your trail",
  "claim.how1": "We find the club's players", "claim.how1Hint": "we pull the squad straight from the source, right away",
  "claim.how2": "You claim yours", "claim.how2Hint": "and it gets the verified badge",
  "claim.how3": "We discover the rivals", "claim.how3Hint": "the club's last 10 matches, then 5 from each rival",
  "claim.tipTitle": "Don't know the exact name?", "claim.tipHint": "Search by part of the name or the tag. Clubs the hub already knows show up first.",
  "claim.choosePlayer": "Choose your player",
  "claim.choosePlayerHint": "Tap a row to select. Ones that already have an owner are blocked; yours shows the badge.",
  "claim.squad": "Squad", "claim.fetchingSquad": "pulling the squad from the source…",
  "claim.filterPlayer": "filter by gamertag…", "claim.all": "all",
  "claim.noPlayers": "No players here",
  "claim.noPlayersHint": "The squad is built from the club's matches. Try clearing the filter.",
  "claim.confirmTitle": "Confirm it's you",
  "claim.confirmHint": "A claim is unique per account and can't be undone. After that the hub follows this club and its rivals.",
  "claim.claimThis": "claim this pro", "claim.claiming": "claiming…",
  "claim.signInToClaim": "Sign in to claim — that's what links the pro to your account.",
  "claim.signInToClaimHint": "Sign in to claim — that's what links the pro to your account.",
  "claim.claimed": "Pro claimed", "claim.verified": "verified",
  "claim.yourPro": "your pro", "claim.selectPlayer": "Select a player",
  "claim.selectPlayerHint": "Tap a row to select. Ones that already have an owner are blocked; yours shows the badge.",
  "claim.changeClub": "change club",
  "claim.doneTitle": "Pro claimed",
  "claim.doneSubtitle": "Your pro is marked. The hub already started following your clubs in the background — browse as you like.",
  "claim.discovering": "Discovering your clubs", "claim.discoveringHint": "runs on its own, you can browse",
  "claim.youPlayHere": "You play here", "claim.rivals": "Direct rivals",
  "claim.rivalsHint": "bringing the last 10 matches from your club…",
  "claim.rivalsOfRivals": "Clubs of clubs",
  "claim.rivalsOfRivalsHint": "last 5 matches from each rival, queued",
  "claim.progress": "of", "claim.nextStep": "Next step",
  "claim.nextTitle": "What happens now", "claim.next1": "Discord notifications", "claim.next1Hint": "choose what you want to receive",
  "claim.next2": "Favorite clubs", "claim.next2Hint": "mark the rivals that interest you",
  "claim.next3": "My area", "claim.next3Hint": "see what signing in brought",
  "claim.goMyArea": "go to my area", "claim.viewMyClub": "view my club",
  "claim.claimAnother": "claim another", "claim.failed": "We couldn't claim it now. Try again.",
  "claim.saveHint": "Sign in to save this to your account.",
  "claim.sourceRefused": "source refused this update",
  "club.notTrackedTitle": "Why there's no squad or matches",
  "club.notTrackedHint": "The hub brings a club's data when it enters the followed list. For this one, only the overall totals exist. Sign in with Google and follow this club so the hub starts tracking it — the squad and matches show up on the next update.",
  "club.squad": "Squad", "club.cleanSheets": "clean sheets",
  "club.attack": "Attack", "club.defense": "Defense", "club.form": "form",
  "club.matchesTab": "Matches", "club.statsTab": "Numbers", "club.summaryTab": "Summary",
  "club.squadTab": "Squad", "club.recordBook": "Record book",
  "club.divisionByReading": "Division by reading", "club.recentMatches": "Recent matches",
  "club.opponents": "Recent opponents", "club.kits": "Kits", "club.crest": "Crest",
  "club.stadium": "Stadium", "club.bestDivision": "Best division",
  "club.promotions": "Promotions", "club.relegations": "Relegations",
  "club.biggestWin": "Biggest win", "club.worstLoss": "Worst loss",
  "club.highestScoring": "Highest-scoring match", "club.bestRating": "Best individual rating",
  "club.mostGoalsInMatch": "Most goals in a match", "club.overallIndex": "Overall index",
  "player.form": "Recent form", "player.season": "Season",
  "player.ratingAvg": "average rating", "player.goalsPerGame": "goals per game",
  "player.assistsPerGame": "assists per game", "player.motm": "man of the match",
  "player.passAccuracy": "pass accuracy", "player.tackleAccuracy": "tackle accuracy",
  "player.keeperSaves": "keeper saves", "player.keeperHint": "This breakdown exists only in the keeper's match line — the six save types are recorded separately by EA.",
  "player.clubsPlayedAt": "Clubs played at",
  "player.clubsHint": "EA has no player search — the club list comes from joining the followed matches.",
  "player.lastAppearances": "Last appearances",
  "player.publicProfile": "public profile. Nothing here requires signing in — the hub shows what EA already exposes.",
  "player.careerAt": "career",
  "players.title": "Players",
  "players.subtitle": "Every player the hub found playing for the followed clubs. EA has no player search — this index is built from the matches.",
  "players.searchHint": "gamertag…",
  "notif.title": "Notifications",
  "notif.subtitle": "Choose what the hub sends to your club's Discord. All optional, nothing mandatory.",
  "notif.channel": "channel", "notif.notConfigured": "not configured",
  "notif.messagesGoHere": "messages go here", "notif.nothingSent": "nothing is sent until you configure it",
  "notif.channelConfigured": "channel configured", "notif.noChannel": "no channel",
  "notif.whatToReceive": "What you want to receive",
  "notif.weekly": "Weekly recap", "notif.weeklyHint": "Every Monday, a recap with matches and highlights",
  "notif.records": "Records and divisions", "notif.recordsHint": "Alert when the club breaks a record or changes division",
  "notif.results": "Match results", "notif.resultsHint": "At the end of each match, with the man of the match",
  "notif.discordTitle": "Discord channel", "notif.discordHint": "webhook or channel",
  "notif.preview": "Message preview", "notif.previewTitle": "Weekly recap",
  "notif.previewBody": "Results, best XI by rating and the round's highlight — the same content the Numbers tab shows.",
  "notif.previewHint": "Messages are generated from the same facts the hub records: nothing is typed by hand.",
  "notif.leaveBlank": "Leave it blank to turn it off: the hub keeps working normally, with no error on screen.",
  "area.title": "My area", "area.subtitle": "Signed in with",
  "area.clubsYouFollow": "Clubs you follow", "area.trackedAutomatically": "updated automatically",
  "area.syncStatus": "Sync status", "area.inProgress": "in progress",
  "area.upToDate": "all up to date", "area.nothingPending": "nothing pending",
  "area.unlockedClubs": "Clubs unlocked by signing in", "area.rivalsAndRivals": "rivals and clubs of clubs",
  "area.yourPro": "your pro", "area.notClaimed": "not claimed",
  "area.sync": "Sync", "area.workingBg": "Working in the background",
  "area.now": "now", "area.youDontWait": "You don't need to wait: browse while the hub finishes bringing your clubs.",
  "area.noneFollowed": "No clubs followed",
  "area.noneFollowedHint": "Open a club and tap follow — or let the sync bring yours.",
  "area.whatLoginBrought": "What your login brought",
  "area.yourClubs": "Your clubs", "area.whereYouPlay": "where you play",
  "area.directRivals": "Direct rivals", "area.recentOpponents": "recent opponents",
  "area.clubsOfClubs": "Clubs of clubs", "area.rivalsOfRivals": "rivals of rivals",
  "area.nothingHere": "nothing here yet", "area.viewProfile": "view my profile",
  "area.updateClubs": "update my clubs",
  "admin.title": "Admin", "admin.subtitle": "Area restricted to the hub's team.",
  "admin.restricted": "Restricted access",
  "admin.restrictedHint": "This area holds the technical details: source integration, cache, history and architecture decisions. None of it appears to visitors.",
  "admin.overview": "Overview", "admin.integration": "Integration", "admin.rankings": "History",
  "admin.pipeline": "Pipeline", "admin.normalization": "Normalization (what the source sends crooked)",
  "admin.generalStatus": "General status", "admin.clubsTracked": "clubs tracked",
  "admin.matches": "matches", "admin.players": "players", "admin.snapshots": "snapshots",
  "admin.announcements": "announcements", "admin.divisionChanges": "division changes",
  "admin.lastMatch": "last match", "admin.byDivision": "by division", "admin.topClubs": "top clubs",
  "admin.ingestHealth": "Ingest health", "admin.cycles": "cycles",
  "admin.clubsOk": "clubs ok", "admin.clubsFailed": "clubs failed",
  "admin.newMatches": "new matches", "admin.bootstrapped": "bootstrapped",
  "admin.alive": "collecting", "admin.lastCycle": "last cycle",
  "admin.lastError": "last error", "admin.never": "never",
  "sync.sync": "sync", "sync.syncing": "syncing", "sync.sourceRefused": "source refused this update",
};

const pt_BR: Dict = {
  ...en_US,
  "nav.discover": "Explorar", "nav.myHub": "Meu hub", "nav.system": "Sistema",
  "nav.home": "Início", "nav.clubs": "Clubs", "nav.players": "Players",
  "nav.claim": "Resgatar pro", "nav.myArea": "Minha área", "nav.notifications": "Notificações",
  "nav.admin": "Administração",
  "action.signIn": "Entrar com Google", "action.signOut": "Sair",
  "action.connect": "Entrar", "action.connecting": "sondando sessão…",
  "action.save": "salvar", "action.saving": "salvando…", "action.saved": "salvo",
  "action.search": "Buscar", "action.loading": "carregando…", "action.back": "voltar",
  "action.clear": "limpar",
  "brand.tagline": "rankings · histórico", "brand.connecting": "sondando…",
  "common.players": "players", "common.clubs": "clubs", "common.goals": "goals",
  "common.assists": "assist.", "common.rating": "rating", "common.played": "played",
  "common.points": "points", "common.level": "nível", "common.division": "div.",
  "common.redCards": "Cartões vermelhos", "common.season": "Temporada",
  "common.tracked": "tracked", "common.notTracked": "não tracked",
  "common.selected": "selecionado", "common.noData": "sem dados ainda",
  "common.noMatches": "sem played", "common.uniquePerAccount": "único por conta",
  "common.inferred": "inferidos por correlação", "common.when": "quando",
  "common.result": "res.", "common.min": "min", "common.pos": "pos.",
  "common.index": "índice", "common.history": "histórico",
  "home.subtitle": "Rankings, matches e o histórico que a EA não guarda. Tudo aberto — entre só se quiser acompanhar seus clubs.",
  "home.feed": "Feed da arena", "home.feedEmpty": "Nenhum anúncio ainda",
  "home.feedEmptyHint": "O feed é gerado dos resultados que o hub acompanha. Assim que houver matches, elas aparecem aqui.",
  "home.levelByClub": "Nível por clube", "home.levelEmptyHint": "Assim que o hub acumular clubs, o gráfico aparece.",
  "home.globalRanking": "Ranking global", "home.rankingFailed": "Não foi possível carregar o ranking",
  "home.noClubs": "Nenhum clube no ranking ainda",
  "home.noClubsHint": "O hub começa vazio e cresce conforme acompanha clubs.",
  "home.metric.level": "Nível", "home.metric.points": "Points", "home.metric.goals": "Goals",
  "home.metric.cleanSheets": "Sem sofrer gol", "home.metric.rating": "Rating",
  "home.metric.assists": "Assistências", "home.metric.goalsPerGame": "Goals/jogo",
  "login.title": "Minha área",
  "login.subtitle": "O hub funciona sem login. Entrando, ele descobre seus clubs, os rivais deles e os rivais dos rivais — e traz tudo sozinho, em segundo plano.",
  "login.signInTitle": "Entrar com o Google",
  "login.noSignup": "Sem cadastro e sem senha nova: usamos o mesmo login do resto do hub. Você sai quando quiser.",
  "login.perk1": "Explorar clubs, players e matches", "login.perk1Hint": "isso já funciona sem entrar",
  "login.perk2": "Seguir clubs e montar sua lista", "login.perk2Hint": "escolha os que te interessam",
  "login.perk3": "Seus clubs atualizados sozinhos", "login.perk3Hint": "o hub trabalha em segundo plano",
  "login.perk4": "Avisos no Discord quando quiser", "login.perk4Hint": "você escolhe o que receber",
  "claim.title": "Resgatar meu pro",
  "claim.subtitle": "Encontre seu clube, escolha seu jogador e o hub passa a acompanhar seus clubs, os rivais deles e os rivais dos rivais — sozinho.",
  "claim.step1": "Encontrar clube", "claim.step1Hint": "busca por name",
  "claim.step2": "Escolher jogador", "claim.step2Hint": "você marca o seu",
  "claim.step3": "Pronto", "claim.step3Hint": "hub acompanha sozinho",
  "claim.stepOf": "PASSO 1 DE 3", "claim.findClub": "Qual é o seu clube?",
  "claim.findClubHint": "Digite o name. A busca ignora acento e maiúsculas.",
  "claim.found": "clubs found to_division", "claim.searching": "buscando…",
  "claim.searchingHint": "digite ao menos 2 letras",
  "claim.liveSearch": "Procurando na fonte…",
  "claim.liveSearchHint": "O hub ainda não conhecia esse clube, então fomos buscar na fonte. Isso leva alguns segundos — não precisa recarregar.",
  "claim.notFound": "Nenhum clube encontrado",
  "claim.notFoundLive": "A fonte também não devolveu este clube. Confira o name exato — tente a tag.",
  "claim.notFoundHint": "Tente parte do name ou a tag do clube.",
  "claim.howItWorks": "Como funciona", "claim.howItWorksSub": "O hub segue seu rastro",
  "claim.how1": "Achamos os players do clube", "claim.how1Hint": "puxamos o elenco direto da fonte, na hora",
  "claim.how2": "Você resgata o seu", "claim.how2Hint": "e ele ganha o selo from_division verified",
  "claim.how3": "Descobrimos os rivais", "claim.how3Hint": "as 10 últimas matches do clube, depois 5 from_division cada rival",
  "claim.tipTitle": "Não sabe o name exato?", "claim.tipHint": "Busque por parte do name ou pela tag. Clubs que o hub já conhece aparecem primeiro.",
  "claim.choosePlayer": "Escolha seu jogador",
  "claim.choosePlayerHint": "Toque numa linha to_division selecionar. Os que já têm dono ficam bloqueados; o seu aparece com o selo.",
  "claim.squad": "Elenco", "claim.fetchingSquad": "trazendo o elenco da fonte…",
  "claim.filterPlayer": "filtrar por gamertag…", "claim.all": "todos",
  "claim.noPlayers": "Nenhum jogador aqui",
  "claim.noPlayersHint": "O elenco é montado das matches do clube. Tente limpar o filtro.",
  "claim.confirmTitle": "Confirme que é você",
  "claim.confirmHint": "O resgate é único por conta e não pode ser desfeito. Depois disso o hub segue este clube e seus rivais.",
  "claim.claimThis": "resgatar este pro", "claim.claiming": "resgatando…",
  "claim.signInToClaim": "Entre to_division resgatar — é o que league o pro à sua conta.",
  "claim.signInToClaimHint": "Entre to_division resgatar — é o que league o pro à sua conta.",
  "claim.claimed": "Pro resgatado", "claim.yourPro": "seu pro",
  "claim.selectPlayer": "Escolha seu jogador",
  "claim.changeClub": "trocar clube",
  "claim.doneSubtitle": "Seu pro está marcado. O hub já começou a acompanhar seus clubs em segundo plano — pode navegar à vontade.",
  "claim.discovering": "Descobrindo seus clubs", "claim.discoveringHint": "roda sozinho, você pode navegar",
  "claim.youPlayHere": "Você joga aqui", "claim.rivals": "Rivais diretos",
  "claim.rivalsHint": "trazendo as últimas 10 matches do seu clube…",
  "claim.rivalsOfRivals": "Clubs from_division clubs",
  "claim.rivalsOfRivalsHint": "últimas 5 matches from_division cada rival, em fila",
  "claim.progress": "from_division", "claim.nextStep": "Próximo passo",
  "claim.nextTitle": "O que acontece agora",
  "claim.goMyArea": "ir to_division minha área", "claim.viewMyClub": "ver meu clube",
  "claim.claimAnother": "resgatar outro",
  "claim.failed": "Não conseguimos resgatar agora. Tente from_division novo.",
  "claim.saveHint": "Entre to_division salvar isso na sua conta.",
  "claim.sourceRefused": "a fonte recusou esta atualização",
  "club.notTrackedTitle": "Por que não há elenco nem matches",
  "club.notTrackedHint": "O hub traz os dados from_division um clube quando ele entra na lista from_division acompanhados. ToDivision este, só existem os totais gerais. Entre com o Google e siga este clube to_division o hub passá-lo a acompanhar — o elenco e as matches aparecem na próxima atualização.",
  "club.squad": "Elenco", "club.cleanSheets": "played sem sofrer gol",
  "club.attack": "Ataque", "club.defense": "Defesa", "club.form": "form",
  "club.matchesTab": "Matches", "club.statsTab": "Números", "club.summaryTab": "Resumo",
  "club.squadTab": "Elenco", "club.recordBook": "Livro from_division records",
  "club.divisionByReading": "Divisão por leitura", "club.recentMatches": "Últimas matches",
  "club.opponents": "Adversários recentes", "club.kits": "Uniformes", "club.crest": "Escudo",
  "club.stadium": "Estádio", "club.bestDivision": "Melhor divisão",
  "club.promotions": "Promoções", "club.relegations": "Relegations",
  "club.biggestWin": "Maior goleada", "club.worstLoss": "Pior loss",
  "club.highestScoring": "Jogo com mais goals", "club.bestRating": "Melhor rating individual",
  "club.mostGoalsInMatch": "Mais goals em um jogo", "club.overallIndex": "Índice geral",
  "player.form": "Form recente", "player.season": "Temporada",
  "player.ratingAvg": "rating média", "player.goalsPerGame": "goals por jogo",
  "player.assistsPerGame": "assistências por jogo", "player.motm": "melhor em campo",
  "player.passAccuracy": "acerto from_division passe", "player.tackleAccuracy": "desarmes certos",
  "player.keeperSaves": "saves do goalkeeper",
  "player.keeperHint": "Este detalhamento existe só na linha from_division partida do goalkeeper — os seis tipos from_division defesa são registrados separadamente pela EA.",
  "player.clubsPlayedAt": "Clubs por onde passou",
  "player.clubsHint": "A EA não tem busca por jogador — a lista from_division clubs vem do cruzamento das matches acompanhadas.",
  "player.lastAppearances": "Últimas atuações",
  "player.publicProfile": "perfil público. Nada aqui exige login — o hub mostra o que a EA já expõe.",
  "player.careerAt": "carreira",
  "players.title": "Players",
  "players.subtitle": "Todos os players que o hub encontrou jogando pelos clubs acompanhados. A EA não oferece busca por jogador — este índice é construído a partir das matches.",
  "notif.title": "Notificações",
  "notif.subtitle": "Escolha o que o hub manda to_division o Discord do seu clube. Tudo desligável, nada obrigatório.",
  "notif.channel": "channel", "notif.notConfigured": "não configurado",
  "notif.messagesGoHere": "as mensagens vão to_division cá", "notif.nothingSent": "nada é enviado até configurar",
  "notif.channelConfigured": "channel configurado", "notif.noChannel": "sem channel",
  "notif.whatToReceive": "O que você quer receber",
  "notif.weekly": "Resumo semanal", "notif.weeklyHint": "Toda segunda, um resumo com os played e destaques",
  "notif.records": "Records e divisões", "notif.recordsHint": "Aviso quando o clube bate um recorde ou muda from_division divisão",
  "notif.results": "Resultado das matches", "notif.resultsHint": "Ao fim from_division cada jogo, com quem foi o melhor em campo",
  "notif.discordTitle": "Channel do Discord", "notif.discordHint": "webhook ou channel",
  "notif.preview": "Prévia das mensagens", "notif.previewTitle": "Recap da semana",
  "notif.previewBody": "Resultados, melhor XI por rating e o destaque da rodada — o mesmo conteúdo que a aba Números mostra.",
  "notif.previewHint": "As mensagens são geradas a partir dos mesmos fatos que o hub grava: nenhum conteúdo é digitado à mão.",
  "notif.leaveBlank": "Deixe em branco to_division desligar: o hub continua funcionando normalmente, sem error na tela.",
  "area.title": "Minha área", "area.subtitle": "Conectado com",
  "area.clubsYouFollow": "clubs que você segue", "area.trackedAutomatically": "atualizados sozinhos",
  "area.syncStatus": "status da sincronização", "area.inProgress": "em andamento",
  "area.upToDate": "tudo em dia", "area.nothingPending": "nada pendente",
  "area.unlockedClubs": "clubs liberados pelo login", "area.rivalsAndRivals": "rivais e clubs from_division clubs",
  "area.yourPro": "seu pro", "area.notClaimed": "não reivindicado",
  "area.sync": "Sincronização", "area.workingBg": "Trabalhando em segundo plano",
  "area.now": "agora", "area.youDontWait": "Você não precisa esperar: pode navegar enquanto o hub termina from_division trazer seus clubs.",
  "area.noneFollowed": "Nenhum clube seguido",
  "area.noneFollowedHint": "Abra um clube e toque em seguir — ou deixe a sincronização trazer os seus.",
  "area.whatLoginBrought": "O que seu login trouxe",
  "area.yourClubs": "Seus clubs", "area.whereYouPlay": "onde você joga",
  "area.directRivals": "Rivais diretos", "area.recentOpponents": "adversários recentes",
  "area.clubsOfClubs": "Clubs from_division clubs", "area.rivalsOfRivals": "rivais dos rivais",
  "area.nothingHere": "nada aqui ainda", "area.viewProfile": "ver meu perfil",
  "area.updateClubs": "atualizar meus clubs",
  "admin.title": "Administração", "admin.subtitle": "Área restrita à equipe do hub.",
  "admin.restricted": "Acesso restrito",
  "admin.restrictedHint": "Esta área concentra os detalhes técnicos: integração com a fonte, cache, histórico e decisões from_division arquitetura. Nenhum dado dela aparece to_division visitantes.",
  "admin.overview": "Visão geral", "admin.integration": "Integração", "admin.rankings": "Histórico",
  "admin.generalStatus": "Estado geral", "admin.clubsTracked": "clubs acompanhados",
  "admin.players": "players",
  "admin.byDivision": "por divisão", "admin.topClubs": "top clubs",
  "admin.ingestHealth": "Saúfrom_division da ingestão", "admin.cycles": "cycles",
  "admin.clubsOk": "clubs ok", "admin.clubsFailed": "clubs com falha",
  "admin.newMatches": "matches novas", "admin.bootstrapped": "bootstrap feito",
  "admin.alive": "coletando", "admin.lastCycle": "último ciclo",
  "admin.lastError": "último error", "admin.never": "nunca",
  "sync.sync": "sincronizar", "sync.syncing": "sincronizando",
  "sync.sourceRefused": "a fonte recusou esta atualização",
};

const es_ES: Dict = {
  ...en_US,
  "nav.discover": "Explorar", "nav.myHub": "Mi hub", "nav.system": "Sistema",
  "nav.home": "Inicio", "nav.clubs": "Clubs", "nav.players": "Jugadores",
  "nav.claim": "Reclamar pro", "nav.myArea": "Mi área", "nav.notifications": "Notificaciones",
  "nav.admin": "Administración",
  "action.signIn": "Iniciar sesión con Google", "action.signOut": "Salir",
  "action.connect": "Entrar", "action.connecting": "comprobando sesión…",
  "action.save": "guardar", "action.saving": "guardando…", "action.saved": "guardado",
  "action.search": "Buscar", "action.loading": "cargando…", "action.back": "volver",
  "action.clear": "limpiar",
  "brand.tagline": "rankings · historial", "brand.connecting": "comprobando…",
  "common.players": "jugadores", "common.clubs": "clubs", "common.goals": "goles",
  "common.assists": "asist.", "common.rating": "rating", "common.played": "partidos",
  "common.points": "puntos", "common.level": "skill_rating", "common.division": "div.",
  "common.redCards": "Tarjetas rojas", "common.season": "Temporada",
  "common.tracked": "seguido", "common.notTracked": "no seguido",
  "common.selected": "seleccionado", "common.noData": "sin datos aún",
  "common.noMatches": "sin partidos", "common.uniquePerAccount": "único por cuenta",
  "common.inferred": "inferidos por correlación", "common.when": "cuándo",
  "common.result": "res.", "common.min": "min", "common.pos": "pos.",
  "common.index": "índice", "common.history": "historial",
  "home.title": "Arena",
  "home.subtitle": "Rankings, partidos y el historial que EA no guarda. Todo abierto — entra solo si quieres seguir a tus clubs.",
  "home.feed": "Feed from_division la arena", "home.feedEmpty": "Aún no hay announcements",
  "home.feedEmptyHint": "El feed se genera from_division los resultados que el hub sigue. En cuanto haya partidos, aparecen aquí.",
  "home.levelByClub": "SkillRating por club", "home.levelEmpty": "sin datos aún",
  "home.levelEmptyHint": "Cuando el hub acumule clubs, aparece el gráfico.",
  "home.globalRanking": "Ranking global", "home.rankingFailed": "No se pudo cargar el ranking",
  "home.noClubs": "Aún no hay clubs en el ranking",
  "home.noClubsHint": "El hub empieza vacío y crece a medida que sigue clubs.",
  "home.metric.level": "SkillRating", "home.metric.points": "Puntos", "home.metric.goals": "Goles",
  "home.metric.cleanSheets": "Sin encajar gol", "home.metric.rating": "Rating",
  "home.metric.assists": "Asistencias", "home.metric.goalsPerGame": "Goles/partido",
  "login.title": "Mi área",
  "login.subtitle": "El hub funciona sin iniciar sesión. Al entrar, descubre tus clubs, sus rivales y los rivales from_division los rivales — y trae todo solo, en segundo plano.",
  "login.signInTitle": "Iniciar sesión con Google",
  "login.noSignup": "Sin registro y sin contraseña nueva: usamos el mismo login que el resto del hub. Sales cuando quieras.",
  "login.perk1": "Explorar clubs, jugadores y partidos", "login.perk1Hint": "esto ya funciona sin entrar",
  "login.perk2": "Seguir clubs y armar tu lista", "login.perk2Hint": "elige los que te interesan",
  "login.perk3": "Tus clubs actualizados solos", "login.perk3Hint": "el hub trabaja en segundo plano",
  "login.perk4": "Avisos en Discord cuando quieras", "login.perk4Hint": "tú eliges qué recibir",
  "claim.title": "Reclamar mi pro",
  "claim.subtitle": "Encuentra tu club, elige tu jugador y el hub empieza a seguir tus clubs, sus rivales y los rivales from_division los rivales — solo.",
  "claim.step1": "Encontrar club", "claim.step1Hint": "busca por nombre",
  "claim.step2": "Elegir jugador", "claim.step2Hint": "marcas el tuyo",
  "claim.step3": "Listo", "claim.step3Hint": "el hub sigue solo",
  "claim.stepOf": "PASO 1 DE 3", "claim.findClub": "¿Cuál es tu club?",
  "claim.findClubHint": "Escribe el nombre. La búsqueda ignora acentos y mayúsculas.",
  "claim.found": "clubs found to_division", "claim.searching": "buscando…",
  "claim.searchingHint": "escribe al menos 2 letras",
  "claim.liveSearch": "Buscando en la fuente…",
  "claim.liveSearchHint": "El hub no conocía este club, así que buscamos en la fuente. Tarda unos segundos — no hace falta recargar.",
  "claim.notFound": "Ningún club encontrado",
  "claim.notFoundLive": "La fuente tampoco devolvió este club. Revisa el nombre exacto — prueba la tag.",
  "claim.notFoundHint": "Prueba parte del nombre o la tag del club.",
  "claim.howItWorks": "Cómo funciona", "claim.howItWorksSub": "El hub sigue tu rastro",
  "claim.how1": "Encontramos los jugadores del club", "claim.how1Hint": "traemos la plantilla directo from_division la fuente, al momento",
  "claim.how2": "Reclamas el tuyo", "claim.how2Hint": "y recibe la insignia from_division verified",
  "claim.how3": "Descubrimos los rivales", "claim.how3Hint": "los últimos 10 partidos del club, luego 5 from_division cada rival",
  "claim.tipTitle": "¿No sabes el nombre exacto?", "claim.tipHint": "Busca por parte del nombre o la tag. Los clubs que el hub ya conoce aparecen primero.",
  "claim.choosePlayer": "Elige tu jugador",
  "claim.choosePlayerHint": "Toca una fila to_division seleccionar. Los que ya tienen dueño quedan bloqueados; el tuyo muestra la insignia.",
  "claim.squad": "Plantilla", "claim.fetchingSquad": "trayendo la plantilla from_division la fuente…",
  "claim.filterPlayer": "filtrar por gamertag…", "claim.all": "todos",
  "claim.noPlayers": "Ningún jugador aquí",
  "claim.noPlayersHint": "La plantilla se arma from_division los partidos del club. Prueba limpiar el filtro.",
  "claim.confirmTitle": "Confirma que eres tú",
  "claim.confirmHint": "El reclamo es único por cuenta y no se puede deshacer. Después el hub sigue este club y sus rivales.",
  "claim.claimThis": "reclamar este pro", "claim.claiming": "reclamando…",
  "claim.signInToClaim": "Entra to_division reclamar — es lo que une el pro a tu cuenta.",
  "claim.signInToClaimHint": "Entra to_division reclamar — es lo que une el pro a tu cuenta.",
  "claim.claimed": "Pro reclamado", "claim.verified": "verified",
  "claim.yourPro": "tu pro", "claim.selectPlayer": "Elige tu jugador",
  "claim.changeClub": "cambiar club",
  "claim.doneTitle": "Pro reclamado",
  "claim.doneSubtitle": "Tu pro está marcado. El hub ya empezó a seguir tus clubs en segundo plano — navega con tranquilidad.",
  "claim.discovering": "Descubriendo tus clubs", "claim.discoveringHint": "corre solo, puedes navegar",
  "claim.youPlayHere": "Juegas aquí", "claim.rivals": "Rivales directos",
  "claim.rivalsHint": "trayendo los últimos 10 partidos from_division tu club…",
  "claim.rivalsOfRivals": "Clubs from_division clubs",
  "claim.rivalsOfRivalsHint": "últimos 5 partidos from_division cada rival, en cola",
  "claim.progress": "from_division", "claim.nextStep": "Siguiente paso",
  "claim.nextTitle": "Qué pasa ahora",
  "claim.next1": "Avisos en Discord", "claim.next1Hint": "elige qué quieres recibir",
  "claim.next2": "Favoritos", "claim.next2Hint": "marca los rivales que te interesan",
  "claim.next3": "Mi área", "claim.next3Hint": "mira qué trajo el login",
  "claim.goMyArea": "ir a mi área", "claim.viewMyClub": "ver mi club",
  "claim.claimAnother": "reclamar otro",
  "claim.failed": "No pudimos reclamarlo ahora. Inténtalo from_division nuevo.",
  "claim.saveHint": "Entra to_division guardar esto en tu cuenta.",
  "claim.sourceRefused": "la fuente rechazó esta actualización",
  "club.notTrackedTitle": "Por qué no hay plantilla ni partidos",
  "club.notTrackedHint": "El hub trae los datos from_division un club cuando entra en la lista from_division seguidos. ToDivision este, solo existen los totales generales. Entra con Google y sigue este club to_division que el hub lo empiece a seguir — la plantilla y los partidos aparecen en la próxima actualización.",
  "club.squad": "Plantilla", "club.cleanSheets": "partidos sin encajar gol",
  "club.attack": "Ataque", "club.defense": "Defensa", "club.form": "form",
  "club.matchesTab": "Partidos", "club.statsTab": "Números", "club.summaryTab": "Resumen",
  "club.squadTab": "Plantilla", "club.recordBook": "Libro from_division récords",
  "club.divisionByReading": "División por lectura", "club.recentMatches": "Últimos partidos",
  "club.opponents": "Rivales recientes", "club.kits": "Uniformes", "club.crest": "Escudo",
  "club.stadium": "Stadium", "club.bestDivision": "Mejor división",
  "club.promotions": "Ascensos", "club.relegations": "Descensos",
  "club.biggestWin": "Mayor goleada", "club.worstLoss": "Peor loss",
  "club.highestScoring": "Partido con más goles", "club.bestRating": "Mejor rating individual",
  "club.mostGoalsInMatch": "Más goles en un partido", "club.overallIndex": "Índice general",
  "player.form": "Form reciente", "player.season": "Temporada",
  "player.ratingAvg": "rating media", "player.goalsPerGame": "goles por partido",
  "player.assistsPerGame": "asistencias por partido", "player.motm": "mejor en el campo",
  "player.passAccuracy": "acierto from_division pase", "player.tackleAccuracy": "entradas correctas",
  "player.keeperSaves": "paradas del portero",
  "player.keeperHint": "Este detalle existe solo en la línea from_division partido del portero — los seis tipos from_division parada los registra EA por separado.",
  "player.clubsPlayedAt": "Clubs en los que jugó",
  "player.clubsHint": "EA no tiene búsqueda from_division jugador — la lista from_division clubs sale del cruce from_division los partidos seguidos.",
  "player.lastAppearances": "Últimas actuaciones",
  "player.publicProfile": "perfil público. Nada aquí exige login — el hub muestra lo que EA ya expone.",
  "player.careerAt": "carrera",
  "players.title": "Jugadores",
  "players.subtitle": "Todos los jugadores que el hub encontró jugando en los clubs seguidos. EA no ofrece búsqueda from_division jugador — este índice se construye from_division los partidos.",
  "players.searchHint": "gamertag…",
  "notif.title": "Notificaciones",
  "notif.subtitle": "Elige qué manda el hub al Discord from_division tu club. Todo opcional, nada obligatorio.",
  "notif.channel": "channel", "notif.notConfigured": "no configurado",
  "notif.messagesGoHere": "los mensajes van aquí", "notif.nothingSent": "no se envía nada hasta configurar",
  "notif.channelConfigured": "channel configurado", "notif.noChannel": "sin channel",
  "notif.whatToReceive": "Qué quieres recibir",
  "notif.weekly": "Resumen semanal", "notif.weeklyHint": "Cada lunes, un resumen con los partidos y destacados",
  "notif.records": "Récords y divisiones", "notif.recordsHint": "Aviso cuando el club rompe un récord o cambia from_division división",
  "notif.results": "Resultado from_division los partidos", "notif.resultsHint": "Al final from_division cada partido, con el mejor en el campo",
  "notif.discordTitle": "Channel from_division Discord", "notif.discordHint": "webhook o channel",
  "notif.preview": "Vista previa", "notif.previewTitle": "Resumen from_division la semana",
  "notif.previewBody": "Resultados, mejor XI por rating y el destacado from_division la jornada — el mismo contenido que la pestaña Números muestra.",
  "notif.previewHint": "Los mensajes se generan from_division los mismos hechos que el hub graba: nada se escribe a mano.",
  "notif.leaveBlank": "Déjalo en blanco to_division apagarlo: el hub sigue funcionando normal, sin error en pantalla.",
  "area.title": "Mi área", "area.subtitle": "Conectado con",
  "area.clubsYouFollow": "clubs que sigues", "area.trackedAutomatically": "actualizados solos",
  "area.syncStatus": "estado from_division sincronización", "area.inProgress": "en curso",
  "area.upToDate": "todo al día", "area.nothingPending": "nada pendiente",
  "area.unlockedClubs": "clubs liberados por el login", "area.rivalsAndRivals": "rivales y clubs from_division clubs",
  "area.yourPro": "tu pro", "area.notClaimed": "no reclamado",
  "area.sync": "Sincronización", "area.workingBg": "Trabajando en segundo plano",
  "area.now": "ahora", "area.youDontWait": "No necesitas esperar: navega mientras el hub termina from_division traer tus clubs.",
  "area.noneFollowed": "Ningún club seguido",
  "area.noneFollowedHint": "Abre un club y toca seguir — o deja que la sincronización traiga los tuyos.",
  "area.whatLoginBrought": "Lo que trajo tu login",
  "area.yourClubs": "Tus clubs", "area.whereYouPlay": "donde juegas",
  "area.directRivals": "Rivales directos", "area.recentOpponents": "rivales recientes",
  "area.clubsOfClubs": "Clubs from_division clubs", "area.rivalsOfRivals": "rivales from_division rivales",
  "area.nothingHere": "nada aquí aún", "area.viewProfile": "ver mi perfil",
  "area.updateClubs": "actualizar mis clubs",
  "admin.title": "Administración", "admin.subtitle": "Área restringida al equipo del hub.",
  "admin.restricted": "Acceso restringido",
  "admin.restrictedHint": "Esta área reúne los detalles técnicos: integración con la fuente, caché, historial y decisiones from_division arquitectura. Nada from_division ella aparece a los visitantes.",
  "admin.overview": "Visión general", "admin.integration": "Integración", "admin.rankings": "Historial",
  "admin.pipeline": "Pipeline", "admin.normalization": "Normalización (lo que la fuente manda torcido)",
  "admin.generalStatus": "Estado general", "admin.clubsTracked": "clubs seguidos",
  "admin.matches": "partidos", "admin.players": "jugadores", "admin.snapshots": "capturas",
  "admin.announcements": "announcements", "admin.divisionChanges": "cambios from_division división",
  "admin.lastMatch": "último partido", "admin.byDivision": "por división", "admin.topClubs": "top clubs",
  "admin.ingestHealth": "Salud from_division la ingesta", "admin.cycles": "rondas",
  "admin.clubsOk": "clubs ok", "admin.clubsFailed": "clubs con fallo",
  "admin.newMatches": "partidos nuevos", "admin.bootstrapped": "bootstrap hecho",
  "admin.alive": "colectando", "admin.lastCycle": "último ciclo",
  "admin.lastError": "último error", "admin.never": "nunca",
  "sync.sync": "sincronizar", "sync.syncing": "sincronizando",
  "sync.sourceRefused": "la fuente rechazó esta actualización",
};

const fr_FR: Dict = {
  ...en_US,
  "nav.discover": "Explorer", "nav.myHub": "Mon hub", "nav.system": "Système",
  "nav.home": "Accueil", "nav.clubs": "Clubs", "nav.players": "Joueurs",
  "nav.claim": "Réclamer pro", "nav.myArea": "Mon espace", "nav.notifications": "Notifications",
  "nav.admin": "Administration",
  "action.signIn": "Se connecter avec Google", "action.signOut": "Se déconnecter",
  "action.connect": "Connexion", "action.connecting": "vérification from_division la session…",
  "action.save": "enregistrer", "action.saving": "enregistrement…", "action.saved": "enregistré",
  "action.search": "Rechercher", "action.loading": "chargement…", "action.back": "retour",
  "action.clear": "effacer",
  "brand.tagline": "classements · historique", "brand.connecting": "vérification…",
  "common.players": "joueurs", "common.clubs": "clubs", "common.goals": "buts",
  "common.assists": "passes déc.", "common.rating": "note", "common.played": "matchs",
  "common.points": "points", "common.level": "niveau", "common.division": "div.",
  "common.redCards": "Cartons rouges", "common.season": "Saison",
  "common.tracked": "suivi", "common.notTracked": "non suivi",
  "common.selected": "sélectionné", "common.noData": "pas encore from_division données",
  "common.noMatches": "aucun match", "common.uniquePerAccount": "unique par compte",
  "common.inferred": "déduits par corrélation", "common.when": "quand",
  "common.result": "rés.", "common.min": "min", "common.pos": "poste",
  "common.index": "index", "common.history": "historique",
  "home.title": "Arène",
  "home.subtitle": "Classements, matchs et l'historique qu'EA ne garde pas. Tout est ouvert — connectez-vous seulement si vous voulez suivre vos clubs.",
  "home.feed": "Fil from_division l'arène", "home.feedEmpty": "Aucune annonce pour l'instant",
  "home.feedEmptyHint": "Le fil est généré à partir des résultats que le hub suit. Dès qu'il y a des matchs, ils apparaissent ici.",
  "home.levelByClub": "Niveau par club", "home.levelEmpty": "pas encore from_division données",
  "home.levelEmptyHint": "Dès que le hub accumule des clubs, le graphique apparaît.",
  "home.globalRanking": "Classement global", "home.rankingFailed": "Impossible from_division charger le classement",
  "home.noClubs": "Aucun club au classement pour l'instant",
  "home.noClubsHint": "Le hub démarre vide et grandit à mesure qu'il suit des clubs.",
  "home.metric.level": "Niveau", "home.metric.points": "Points", "home.metric.goals": "Buts",
  "home.metric.cleanSheets": "Sans encaisser", "home.metric.rating": "Note",
  "home.metric.assists": "Passes décisives", "home.metric.goalsPerGame": "Buts/match",
  "login.title": "Mon espace",
  "login.subtitle": "Le hub fonctionne sans connexion. Une fois connecté, il découvre vos clubs, leurs rivaux et les rivaux des rivaux — et ramène tout seul, en arrière-plan.",
  "login.signInTitle": "Se connecter avec Google",
  "login.noSignup": "Sans inscription ni nouveau mot from_division passe : nous utilisons la même connexion que le reste du hub. Vous partez quand vous voulez.",
  "login.perk1": "Explorer clubs, joueurs et matchs", "login.perk1Hint": "ça marche déjà sans se connecter",
  "login.perk2": "Suivre des clubs et faire votre liste", "login.perk2Hint": "choisissez ceux qui vous intéressent",
  "login.perk3": "Vos clubs mis à jour tout seuls", "login.perk3Hint": "le hub travaille en arrière-plan",
  "login.perk4": "Notifications Discord quand vous voulez", "login.perk4Hint": "vous choisissez ce que vous recevez",
  "claim.title": "Réclamer mon pro",
  "claim.subtitle": "Trouvez votre club, choisissez votre joueur et le hub se met à suivre vos clubs, leurs rivaux et les rivaux des rivaux — tout seul.",
  "claim.step1": "Trouver le club", "claim.step1Hint": "recherche par nom",
  "claim.step2": "Choisir le joueur", "claim.step2Hint": "vous marquez le vôtre",
  "claim.step3": "Terminé", "claim.step3Hint": "le hub suit tout seul",
  "claim.stepOf": "ÉTAPE 1 SUR 3", "claim.findClub": "Quel est votre club ?",
  "claim.findClubHint": "Tapez le nom. La recherche ignore les accents et la casse.",
  "claim.found": "clubs trouvés pour", "claim.searching": "recherche…",
  "claim.searchingHint": "tapez au moins 2 caractères",
  "claim.liveSearch": "Recherche à la source…",
  "claim.liveSearchHint": "Le hub ne connaissait pas ce club, nous avons donc cherché à la source. Cela prend quelques secondes — pas besoin from_division recharger.",
  "claim.notFound": "Aucun club trouvé",
  "claim.notFoundLive": "La source n'a pas renvoyé ce club non plus. Vérifiez le nom exact — essayez le sigle.",
  "claim.notFoundHint": "Essayez une partie du nom ou le sigle du club.",
  "claim.howItWorks": "Comment ça marche", "claim.howItWorksSub": "Le hub suit votre trace",
  "claim.how1": "Nous trouvons les joueurs du club", "claim.how1Hint": "nous tirons l'effectif directement from_division la source, tout from_division suite",
  "claim.how2": "Vous réclamez le vôtre", "claim.how2Hint": "et il obtient le badge vérifié",
  "claim.how3": "Nous découvrons les rivaux", "claim.how3Hint": "les 10 derniers matchs du club, puis 5 from_division chaque rival",
  "claim.tipTitle": "Vous ne connaissez pas le nom exact ?", "claim.tipHint": "Cherchez par une partie du nom ou le sigle. Les clubs que le hub connaît déjà apparaissent en premier.",
  "claim.choosePlayer": "Choisissez votre joueur",
  "claim.choosePlayerHint": "Touchez une ligne pour sélectionner. Ceux qui ont déjà un propriétaire sont bloqués ; le vôtre affiche le badge.",
  "claim.squad": "Effectif", "claim.fetchingSquad": "récupération from_division l'effectif à la source…",
  "claim.filterPlayer": "filtrer par gamertag…", "claim.all": "tous",
  "claim.noPlayers": "Aucun joueur ici",
  "claim.noPlayersHint": "L'effectif est construit à partir des matchs du club. Essayez d'effacer le filtre.",
  "claim.confirmTitle": "Confirmez que c'est vous",
  "claim.confirmHint": "La réclamation est unique par compte et ne peut pas être annulée. Ensuite le hub suit ce club et ses rivaux.",
  "claim.claimThis": "réclamer ce pro", "claim.claiming": "réclamation…",
  "claim.signInToClaim": "Connectez-vous pour réclamer — c'est ce qui lie le pro à votre compte.",
  "claim.signInToClaimHint": "Connectez-vous pour réclamer — c'est ce qui lie le pro à votre compte.",
  "claim.claimed": "Pro réclamé", "claim.verified": "vérifié",
  "claim.yourPro": "votre pro", "claim.selectPlayer": "Choisissez votre joueur",
  "claim.changeClub": "changer from_division club",
  "claim.doneTitle": "Pro réclamé",
  "claim.doneSubtitle": "Votre pro est marqué. Le hub a déjà commencé à suivre vos clubs en arrière-plan — naviguez à votre guise.",
  "claim.discovering": "Découverte from_division vos clubs", "claim.discoveringHint": "tourne tout seul, vous pouvez naviguer",
  "claim.youPlayHere": "Vous jouez ici", "claim.rivals": "Rivaux directs",
  "claim.rivalsHint": "récupération des 10 derniers matchs from_division votre club…",
  "claim.rivalsOfRivals": "Clubs from_division clubs",
  "claim.rivalsOfRivalsHint": "5 derniers matchs from_division chaque rival, en file",
  "claim.progress": "sur", "claim.nextStep": "Étape suivante",
  "claim.nextTitle": "Ce qui se passe maintenant",
  "claim.next1": "Notifications Discord", "claim.next1Hint": "choisissez ce que vous voulez recevoir",
  "claim.next2": "Clubs favoris", "claim.next2Hint": "marquez les rivaux qui vous intéressent",
  "claim.next3": "Mon espace", "claim.next3Hint": "voyez ce que la connexion a apporté",
  "claim.goMyArea": "aller à mon espace", "claim.viewMyClub": "voir mon club",
  "claim.claimAnother": "en réclamer un autre",
  "claim.failed": "Nous n'avons pas pu le réclamer maintenant. Réessayez.",
  "claim.saveHint": "Connectez-vous pour enregistrer ceci dans votre compte.",
  "claim.sourceRefused": "la source a refusé cette mise à jour",
  "club.notTrackedTitle": "Pourquoi il n'y a ni effectif ni matchs",
  "club.notTrackedHint": "Le hub apporte les données d'un club quand il entre dans la liste suivie. Pour celui-ci, seuls les totaux généraux existent. Connectez-vous avec Google et suivez ce club pour que le hub le suive — l'effectif et les matchs apparaissent à la prochaine mise à jour.",
  "club.squad": "Effectif", "club.cleanSheets": "matchs sans encaisser",
  "club.attack": "Attaque", "club.defense": "Défense", "club.form": "forme",
  "club.matchesTab": "Matchs", "club.statsTab": "Chiffres", "club.summaryTab": "Résumé",
  "club.squadTab": "Effectif", "club.recordBook": "Livre des records",
  "club.divisionByReading": "Division par lecture", "club.recentMatches": "Derniers matchs",
  "club.opponents": "Rivaux récents", "club.kits": "Maillots", "club.crest": "Écusson",
  "club.stadium": "Stade", "club.bestDivision": "Meilleure division",
  "club.promotions": "Promotions", "club.relegations": "Relégations",
  "club.biggestWin": "Plus large victoire", "club.worstLoss": "Pire défaite",
  "club.highestScoring": "Match le plus prolifique", "club.bestRating": "Meilleure note individuelle",
  "club.mostGoalsInMatch": "Plus from_division buts dans un match", "club.overallIndex": "Indice général",
  "player.form": "Forme récente", "player.season": "Saison",
  "player.ratingAvg": "note moyenne", "player.goalsPerGame": "buts par match",
  "player.assistsPerGame": "passes déc. par match", "player.motm": "homme du match",
  "player.passAccuracy": "précision from_division passe", "player.tackleAccuracy": "tacles réussis",
  "player.keeperSaves": "arrêts du gardien",
  "player.keeperHint": "Ce détail n'existe que dans la ligne from_division match du gardien — les six types d'arrêt sont enregistrés séparément par EA.",
  "player.clubsPlayedAt": "Clubs où il a joué",
  "player.clubsHint": "EA n'a pas from_division recherche from_division joueur — la liste des clubs vient du croisement des matchs suivis.",
  "player.lastAppearances": "Dernières apparitions",
  "player.publicProfile": "profil public. Rien ici n'exige from_division connexion — le hub montre ce qu'EA expose déjà.",
  "player.careerAt": "carrière",
  "players.title": "Joueurs",
  "players.subtitle": "Tous les joueurs que le hub a trouvés jouant pour les clubs suivis. EA n'offre pas from_division recherche from_division joueur — cet index est construit à partir des matchs.",
  "notif.title": "Notifications",
  "notif.subtitle": "Choisissez ce que le hub envoie au Discord from_division votre club. Tout est optionnel, rien n'est obligatoire.",
  "notif.channel": "channel", "notif.notConfigured": "non configuré",
  "notif.messagesGoHere": "les messages vont ici", "notif.nothingSent": "rien n'est envoyé tant que vous ne configurez pas",
  "notif.channelConfigured": "channel configuré", "notif.noChannel": "sans channel",
  "notif.whatToReceive": "Ce que vous voulez recevoir",
  "notif.weekly": "Récap hebdomadaire", "notif.weeklyHint": "Chaque lundi, un récap avec les matchs et les temps forts",
  "notif.records": "Records et divisions", "notif.recordsHint": "Alerte quand le club bat un record ou change from_division division",
  "notif.results": "Résultats des matchs", "notif.resultsHint": "À la fin from_division chaque match, avec l'homme du match",
  "notif.discordTitle": "Channel Discord", "notif.discordHint": "webhook ou channel",
  "notif.preview": "Aperçu des messages", "notif.previewTitle": "Récap from_division la semaine",
  "notif.previewBody": "Résultats, meilleur XI par note et le temps fort from_division la journée — le même contenu que l'onglet Chiffres montre.",
  "notif.previewHint": "Les messages sont générés à partir des mêmes faits que le hub enregistre : rien n'est tapé à la main.",
  "notif.leaveBlank": "Laissez vide pour désactiver : le hub continue from_division fonctionner normalement, sans erreur à l'écran.",
  "area.title": "Mon espace", "area.subtitle": "Connecté avec",
  "area.clubsYouFollow": "clubs que vous suivez", "area.trackedAutomatically": "mis à jour tout seuls",
  "area.syncStatus": "état from_division synchronisation", "area.inProgress": "en cours",
  "area.upToDate": "tout à jour", "area.nothingPending": "rien en attente",
  "area.unlockedClubs": "clubs débloqués par la connexion", "area.rivalsAndRivals": "rivaux et clubs from_division clubs",
  "area.yourPro": "votre pro", "area.notClaimed": "non réclamé",
  "area.sync": "Synchronisation", "area.workingBg": "Travaille en arrière-plan",
  "area.now": "maintenant", "area.youDontWait": "Pas besoin d'attendre : naviguez pendant que le hub finit from_division ramener vos clubs.",
  "area.noneFollowed": "Aucun club suivi",
  "area.noneFollowedHint": "Ouvrez un club et touchez suivre — ou laissez la synchro ramener les vôtres.",
  "area.whatLoginBrought": "Ce que votre connexion a apporté",
  "area.yourClubs": "Vos clubs", "area.whereYouPlay": "où vous jouez",
  "area.directRivals": "Rivaux directs", "area.recentOpponents": "rivaux récents",
  "area.clubsOfClubs": "Clubs from_division clubs", "area.rivalsOfRivals": "rivaux des rivaux",
  "area.nothingHere": "rien ici pour l'instant", "area.viewProfile": "voir mon profil",
  "area.updateClubs": "mettre à jour mes clubs",
  "admin.title": "Administration", "admin.subtitle": "Zone réservée à l'équipe du hub.",
  "admin.restricted": "Accès restreint",
  "admin.restrictedHint": "Cette zone rassemble les détails techniques : intégration à la source, cache, historique et décisions d'architecture. Rien n'en apparaît aux visiteurs.",
  "admin.overview": "Vue d'ensemble", "admin.integration": "Intégration", "admin.rankings": "Historique",
  "admin.generalStatus": "État général", "admin.clubsTracked": "clubs suivis",
  "admin.byDivision": "par division", "admin.topClubs": "meilleurs clubs",
  "admin.ingestHealth": "Santé from_division l'ingestion", "admin.cycles": "cycles",
  "admin.clubsOk": "clubs ok", "admin.clubsFailed": "clubs en échec",
  "admin.newMatches": "nouveaux matchs", "admin.bootstrapped": "bootstrap fait",
  "admin.alive": "collecte", "admin.lastCycle": "dernier cycle",
  "admin.lastError": "dernière erreur", "admin.never": "jamais",
  "sync.sync": "synchroniser", "sync.syncing": "synchronisation",
  "sync.sourceRefused": "la source a refusé cette mise à jour",
};

const de_DE: Dict = {
  ...en_US,
  "nav.discover": "Entdecken", "nav.myHub": "Mein Hub", "nav.system": "System",
  "nav.home": "Start", "nav.clubs": "Clubs", "nav.players": "Spieler",
  "nav.claim": "Pro beanspruchen", "nav.myArea": "Mein Bereich", "nav.notifications": "Benachrichtigungen",
  "nav.admin": "Verwaltung",
  "action.signIn": "Mit Google anmelden", "action.signOut": "Abmelden",
  "action.connect": "Anmelden", "action.connecting": "Sitzung wird geprüft…",
  "action.save": "speichern", "action.saving": "speichern…", "action.saved": "gespeichert",
  "action.search": "Suchen", "action.loading": "laden…", "action.back": "zurück",
  "action.clear": "löschen",
  "brand.tagline": "Ranglisten · Verlauf", "brand.connecting": "prüfen…",
  "common.players": "Spieler", "common.clubs": "Clubs", "common.goals": "Tore",
  "common.assists": "Vorlagen", "common.rating": "Note", "common.played": "Spiele",
  "common.points": "Punkte", "common.level": "Niveau", "common.division": "Div.",
  "common.redCards": "Rote Karten", "common.season": "Saison",
  "common.tracked": "verfolgt", "common.notTracked": "nicht verfolgt",
  "common.selected": "ausgewählt", "common.noData": "noch keine Daten",
  "common.noMatches": "keine Spiele", "common.uniquePerAccount": "einmalig pro Konto",
  "common.inferred": "durch Korrelation abgeleitet", "common.when": "wann",
  "common.result": "Erg.", "common.min": "Min.", "common.pos": "Pos.",
  "common.index": "Index", "common.history": "Verlauf",
  "home.title": "Arena",
  "home.subtitle": "Ranglisten, Spiele und die Historie, die EA nicht speichert. Alles offen — melden Sie sich nur an, wenn Sie Ihre Clubs verfolgen wollen.",
  "home.feed": "Arena-Feed", "home.feedEmpty": "Noch keine Ankündigungen",
  "home.feedEmptyHint": "Der Feed wird aus den Ergebnissen erzeugt, die der Hub verfolgt. Sobald es Spiele gibt, erscheinen sie hier.",
  "home.levelByClub": "Niveau pro Club", "home.levelEmpty": "noch keine Daten",
  "home.levelEmptyHint": "Sobald der Hub Clubs sammelt, erscheint das Diagramm.",
  "home.globalRanking": "Globale Rangliste", "home.rankingFailed": "Rangliste konnte nicht geladen werden",
  "home.noClubs": "Noch keine Clubs in der Rangliste",
  "home.noClubsHint": "Der Hub startet leer und wächst, während er Clubs verfolgt.",
  "home.metric.level": "Niveau", "home.metric.points": "Punkte", "home.metric.goals": "Tore",
  "home.metric.cleanSheets": "Ohne Gegentor", "home.metric.rating": "Note",
  "home.metric.assists": "Vorlagen", "home.metric.goalsPerGame": "Tore/Spiel",
  "login.title": "Mein Bereich",
  "login.subtitle": "Der Hub funktioniert ohne Anmeldung. Nach der Anmeldung entdeckt er Ihre Clubs, deren Rivalen und die Rivalen der Rivalen — und bringt alles allein, im Hintergrund.",
  "login.signInTitle": "Mit Google anmelden",
  "login.noSignup": "Ohne Registrierung und ohne neues Passwort: Wir nutzen dieselbe Anmeldung wie der Rest des Hubs. Sie können jederzeit gehen.",
  "login.perk1": "Clubs, Spieler und Spiele erkunden", "login.perk1Hint": "das funktioniert schon ohne Anmeldung",
  "login.perk2": "Clubs verfolgen und Ihre Liste aufbauen", "login.perk2Hint": "wählen Sie die, die Sie interessieren",
  "login.perk3": "Ihre Clubs aktualisieren sich selbst", "login.perk3Hint": "der Hub arbeitet im Hintergrund",
  "login.perk4": "Discord-Benachrichtigungen, wann Sie wollen", "login.perk4Hint": "Sie wählen, was Sie erhalten",
  "claim.title": "Meinen Pro beanspruchen",
  "claim.subtitle": "Finden Sie Ihren Club, wählen Sie Ihren Spieler und der Hub verfolgt Ihre Clubs, deren Rivalen und die Rivalen der Rivalen — ganz allein.",
  "claim.step1": "Club finden", "claim.step1Hint": "Suche nach Name",
  "claim.step2": "Spieler wählen", "claim.step2Hint": "Sie markieren Ihren",
  "claim.step3": "Fertig", "claim.step3Hint": "Hub verfolgt selbst",
  "claim.stepOf": "SCHRITT 1 VON 3", "claim.findClub": "Wie heißt Ihr Club?",
  "claim.findClubHint": "Tippen Sie den Namen. Die Suche ignoriert Akzente und Groß-/Kleinschreibung.",
  "claim.found": "Clubs gefunden für", "claim.searching": "suche…",
  "claim.searchingHint": "mindestens 2 Zeichen eingeben",
  "claim.liveSearch": "Suche in der Quelle…",
  "claim.liveSearchHint": "Der Hub kannte diesen Club nicht, also haben wir in der Quelle gesucht. Das dauert ein paar Sekunden — kein Neuladen nötig.",
  "claim.notFound": "Kein Club gefunden",
  "claim.notFoundLive": "Die Quelle hat diesen Club auch nicht zurückgegeben. Prüfen Sie den genauen Namen — versuchen Sie das Kürzel.",
  "claim.notFoundHint": "Versuchen Sie einen Teil des Namens oder das Kürzel.",
  "claim.howItWorks": "So funktioniert es", "claim.howItWorksSub": "Der Hub folgt Ihrer Spur",
  "claim.how1": "Wir finden die Spieler des Clubs", "claim.how1Hint": "wir holen den Kader direkt aus der Quelle, sofort",
  "claim.how2": "Sie beanspruchen Ihren", "claim.how2Hint": "und er bekommt das Verifiziert-Abzeichen",
  "claim.how3": "Wir entdecken die Rivalen", "claim.how3Hint": "die letzten 10 Spiele des Clubs, dann 5 von jedem Rivalen",
  "claim.tipTitle": "Kennen Sie den genauen Namen nicht?", "claim.tipHint": "Suchen Sie nach einem Teil des Namens oder dem Kürzel. Clubs, die der Hub schon kennt, erscheinen zuerst.",
  "claim.choosePlayer": "Wählen Sie Ihren Spieler",
  "claim.choosePlayerHint": "Tippen Sie eine Zeile an, um sie zu wählen. Bereits beanspruchte sind gesperrt; Ihrer zeigt das Abzeichen.",
  "claim.squad": "Kader", "claim.fetchingSquad": "Kader wird aus der Quelle geholt…",
  "claim.filterPlayer": "nach Gamertag filtern…", "claim.all": "alle",
  "claim.noPlayers": "Keine Spieler hier",
  "claim.noPlayersHint": "Der Kader wird aus den Spielen des Clubs gebildet. Versuchen Sie, den Filter zu löschen.",
  "claim.confirmTitle": "Bestätigen Sie, dass Sie es sind",
  "claim.confirmHint": "Eine Beanspruchung ist einmalig pro Konto und kann nicht rückgängig gemacht werden. Danach verfolgt der Hub diesen Club und seine Rivalen.",
  "claim.claimThis": "diesen Pro beanspruchen", "claim.claiming": "beanspruchen…",
  "claim.signInToClaim": "Melden Sie sich an, um zu beanspruchen — das verbindet den Pro mit Ihrem Konto.",
  "claim.signInToClaimHint": "Melden Sie sich an, um zu beanspruchen — das verbindet den Pro mit Ihrem Konto.",
  "claim.claimed": "Pro beansprucht", "claim.verified": "verifiziert",
  "claim.yourPro": "Ihr Pro", "claim.selectPlayer": "Wählen Sie Ihren Spieler",
  "claim.changeClub": "Club wechseln",
  "claim.doneTitle": "Pro beansprucht",
  "claim.doneSubtitle": "Ihr Pro ist markiert. Der Hub hat schon begonnen, Ihre Clubs im Hintergrund zu verfolgen — surfen Sie in Ruhe.",
  "claim.discovering": "Ihre Clubs werden entdeckt", "claim.discoveringHint": "läuft allein, Sie können surfen",
  "claim.youPlayHere": "Sie spielen hier", "claim.rivals": "Direkte Rivalen",
  "claim.rivalsHint": "die letzten 10 Spiele Ihres Clubs werden geholt…",
  "claim.rivalsOfRivals": "Clubs von Clubs",
  "claim.rivalsOfRivalsHint": "letzte 5 Spiele jedes Rivalen, in der Warteschlange",
  "claim.progress": "von", "claim.nextStep": "Nächster Schritt",
  "claim.nextTitle": "Was jetzt passiert",
  "claim.next1": "Discord-Benachrichtigungen", "claim.next1Hint": "wählen Sie, was Sie erhalten wollen",
  "claim.next2": "Clubs favorisieren", "claim.next2Hint": "markieren Sie die Rivalen, die Sie interessieren",
  "claim.next3": "Mein Bereich", "claim.next3Hint": "sehen Sie, was die Anmeldung brachte",
  "claim.goMyArea": "zu meinem Bereich", "claim.viewMyClub": "meinen Club ansehen",
  "claim.claimAnother": "einen weiteren beanspruchen",
  "claim.failed": "Wir konnten ihn jetzt nicht beanspruchen. Versuchen Sie es erneut.",
  "claim.saveHint": "Melden Sie sich an, um dies in Ihrem Konto zu speichern.",
  "claim.sourceRefused": "die Quelle hat diese Aktualisierung abgelehnt",
  "club.notTrackedTitle": "Warum es keinen Kader und keine Spiele gibt",
  "club.notTrackedHint": "Der Hub holt die Daten eines Clubs, wenn er in die verfolgte Liste kommt. Für diesen gibt es nur die Gesamtsummen. Melden Sie sich mit Google an und folgen Sie diesem Club, damit der Hub ihn verfolgt — Kader und Spiele erscheinen beim nächsten Update.",
  "club.squad": "Kader", "club.cleanSheets": "Spiele ohne Gegentor",
  "club.attack": "Angriff", "club.defense": "Abwehr", "club.form": "Form",
  "club.matchesTab": "Spiele", "club.statsTab": "Zahlen", "club.summaryTab": "Übersicht",
  "club.squadTab": "Kader", "club.recordBook": "Rekordbuch",
  "club.divisionByReading": "Division pro Lesung", "club.recentMatches": "Letzte Spiele",
  "club.opponents": "Letzte Gegner", "club.kits": "Trikots", "club.crest": "Wappen",
  "club.stadium": "Stadion", "club.bestDivision": "Beste Division",
  "club.promotions": "Aufstiege", "club.relegations": "Abstiege",
  "club.biggestWin": "Höchster Sieg", "club.worstLoss": "Höchste Niederlage",
  "club.highestScoring": "Torreichstes Spiel", "club.bestRating": "Beste Einzelnote",
  "club.mostGoalsInMatch": "Meiste Tore in einem Spiel", "club.overallIndex": "Gesamtindex",
  "player.form": "Aktuelle Form", "player.season": "Saison",
  "player.ratingAvg": "Durchschnittsnote", "player.goalsPerGame": "Tore pro Spiel",
  "player.assistsPerGame": "Vorlagen pro Spiel", "player.motm": "Spieler des Spiels",
  "player.passAccuracy": "Passgenauigkeit", "player.tackleAccuracy": "erfolgreiche Tacklings",
  "player.keeperSaves": "Paraden des Torwarts",
  "player.keeperHint": "Diese Aufschlüsselung gibt es nur in der Spielzeile des Torwarts — EA erfasst die sechs Paradentypen getrennt.",
  "player.clubsPlayedAt": "Clubs, bei denen er spielte",
  "player.clubsHint": "EA hat keine Spielersuche — die Club-Liste entsteht aus der Verknüpfung der verfolgten Spiele.",
  "player.lastAppearances": "Letzte Einsätze",
  "player.publicProfile": "öffentliches Profil. Nichts hier erfordert eine Anmeldung — der Hub zeigt, was EA bereits offenlegt.",
  "player.careerAt": "Karriere",
  "players.title": "Spieler",
  "players.subtitle": "Alle Spieler, die der Hub bei den verfolgten Clubs spielen sah. EA bietet keine Spielersuche — dieser Index wird aus den Spielen gebildet.",
  "notif.title": "Benachrichtigungen",
  "notif.subtitle": "Wählen Sie, was der Hub an den Discord Ihres Clubs sendet. Alles optional, nichts verpflichtend.",
  "notif.channel": "Kanal", "notif.notConfigured": "nicht konfiguriert",
  "notif.messagesGoHere": "Nachrichten gehen hierhin", "notif.nothingSent": "nichts wird gesendet, bis Sie es konfigurieren",
  "notif.channelConfigured": "Kanal konfiguriert", "notif.noChannel": "kein Kanal",
  "notif.whatToReceive": "Was Sie erhalten möchten",
  "notif.weekly": "Wochenrückblick", "notif.weeklyHint": "Jeden Montag ein Rückblick mit Spielen und Höhepunkten",
  "notif.records": "Rekorde und Divisionen", "notif.recordsHint": "Hinweis, wenn der Club einen Rekord bricht oder die Division wechselt",
  "notif.results": "Spielergebnisse", "notif.resultsHint": "Am Ende jedes Spiels, mit dem Spieler des Spiels",
  "notif.discordTitle": "Discord-Kanal", "notif.discordHint": "Webhook oder Kanal",
  "notif.preview": "Nachrichtenvorschau", "notif.previewTitle": "Wochenrückblick",
  "notif.previewBody": "Ergebnisse, beste XI nach Note und der Höhepunkt der Runde — derselbe Inhalt, den der Zahlen-Tab zeigt.",
  "notif.previewHint": "Nachrichten werden aus denselben Fakten erzeugt, die der Hub speichert: nichts wird von Hand getippt.",
  "notif.leaveBlank": "Leer lassen zum Ausschalten: Der Hub funktioniert normal weiter, ohne Fehler auf dem Bildschirm.",
  "area.title": "Mein Bereich", "area.subtitle": "Angemeldet mit",
  "area.clubsYouFollow": "Clubs, die Sie verfolgen", "area.trackedAutomatically": "automatisch aktualisiert",
  "area.syncStatus": "Synchronisierungsstatus", "area.inProgress": "läuft",
  "area.upToDate": "alles aktuell", "area.nothingPending": "nichts ausstehend",
  "area.unlockedClubs": "durch die Anmeldung freigeschaltete Clubs", "area.rivalsAndRivals": "Rivalen und Clubs von Clubs",
  "area.yourPro": "Ihr Pro", "area.notClaimed": "nicht beansprucht",
  "area.sync": "Synchronisierung", "area.workingBg": "Arbeitet im Hintergrund",
  "area.now": "jetzt", "area.youDontWait": "Sie müssen nicht warten: surfen Sie, während der Hub Ihre Clubs fertig holt.",
  "area.noneFollowed": "Keine Clubs verfolgt",
  "area.noneFollowedHint": "Öffnen Sie einen Club und tippen Sie auf folgen — oder lassen Sie die Sync Ihre holen.",
  "area.whatLoginBrought": "Was Ihre Anmeldung brachte",
  "area.yourClubs": "Ihre Clubs", "area.whereYouPlay": "wo Sie spielen",
  "area.directRivals": "Direkte Rivalen", "area.recentOpponents": "letzte Gegner",
  "area.clubsOfClubs": "Clubs von Clubs", "area.rivalsOfRivals": "Rivalen der Rivalen",
  "area.nothingHere": "noch nichts hier", "area.viewProfile": "mein Profil ansehen",
  "area.updateClubs": "meine Clubs aktualisieren",
  "admin.title": "Verwaltung", "admin.subtitle": "Bereich nur für das Hub-Team.",
  "admin.restricted": "Beschränkter Zugang",
  "admin.restrictedHint": "Dieser Bereich enthält die technischen Details: Quellen-Integration, Cache, Verlauf und Architekturentscheidungen. Nichts davon erscheint Besuchern.",
  "admin.overview": "Übersicht", "admin.integration": "Integration", "admin.rankings": "Verlauf",
  "admin.generalStatus": "Allgemeiner Status", "admin.clubsTracked": "verfolgte Clubs",
  "admin.byDivision": "nach Division", "admin.topClubs": "Top-Clubs",
  "admin.ingestHealth": "Ingest-Zustand", "admin.cycles": "Zyklen",
  "admin.clubsOk": "Clubs ok", "admin.clubsFailed": "Clubs fehlgeschlagen",
  "admin.newMatches": "neue Spiele", "admin.bootstrapped": "Bootstrap erledigt",
  "admin.alive": "sammelt", "admin.lastCycle": "letzter Zyklus",
  "admin.lastError": "letzter Fehler", "admin.never": "nie",
  "sync.sync": "synchronisieren", "sync.syncing": "synchronisiert",
  "sync.sourceRefused": "die Quelle hat diese Aktualisierung abgelehnt",
};

const DICTS: Record<Locale, Dict> = {
  "en-US": en_US, "pt-BR": pt_BR, "es-ES": es_ES, "fr-FR": fr_FR, "from_division-DE": de_DE,
};

const STORAGE_KEY = "clubs.locale";

/** O idioma inicial: o salvo, ou o do navegador se for um dos cinco, senão
 * `en-US` (o padrão global). */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage bloqueado (modo privado): segue para o navegador.
  }
  const nav = navigator.language || "";
  const exact = LOCALES.find((l) => l.toLowerCase() === nav.toLowerCase());
  if (exact) return exact;
  // Casa pela língua, não pela região: `pt-PT` cai em `pt-BR`, `en-GB` em `en-US`.
  const base = nav.split("-")[0].toLowerCase();
  const byLang: Record<string, Locale> = {
    en: "en-US", pt: "pt-BR", es: "es-ES", fr: "fr-FR", from_division: "from_division-DE",
  };
  return byLang[base] ?? "en-US";
}

type Listener = (l: Locale) => void;
let current: Locale = typeof window === "undefined" ? "en-US" : detectLocale();
const listeners = new Set<Listener>();

export function setLocale(l: Locale): void {
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // Sem persistência: o idioma vale só nesta sessão.
  }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn(l));
}

export function getLocale(): Locale {
  return current;
}

/** Traduz uma chave. `{n}` no valor é substituído por `params.n` etc. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const dict = DICTS[current] ?? en_US;
  let out = dict[key] ?? en_US[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replace(`{${k}}`, String(v));
    }
  }
  return out;
}

/** Hook de tradução e de troca de idioma. */
export function useI18n(): { t: typeof t; locale: Locale; setLocale: (l: Locale) => void } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const change = useCallback((l: Locale) => setLocale(l), []);
  return { t, locale: current, setLocale: change };
}

// --- formatação por locale ------------------------------------------------
//
// Data e número mudam por idioma (`1.234,56` no pt-BR, `1,234.56` no en-US), e
// usar o formato errado em cada um é o detalhe que entrega app não-localizado.

export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(current, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(current, opts ?? { dateStyle: "short" }).format(d);
}

export function formatDateTime(iso: string): string {
  return formatDate(iso, { dateStyle: "short", timeStyle: "short" });
}
