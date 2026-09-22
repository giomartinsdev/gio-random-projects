#!/usr/bin/env python3
"""Seed the local dev database through the REAL write path (domain-api /sync and
the async 202 routes), never by inserting rows directly.

This is a fixture generator for local testing: it speaks the same HTTP API the
clubs-ingest worker speaks, so what it produces is exactly what the worker would
produce. It is NOT part of the product.

Usage: python3 seed.py [--api http://localhost:8000] [--key devkey]
"""

from __future__ import annotations

import argparse
import json
import random
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

random.seed(20260922)

CLUBS = [
    ("1001", "Vila Nova FC", "VNV", "Arena Vila Nova", 0x2FBF71, 0xFFFFFF),
    ("1002", "Atlético Central", "ATC", "Estádio Central", 0xD62828, 0x111111),
    ("1003", "Porto Rival", "PRV", "Cais Arena", 0x1D4ED8, 0xFFFFFF),
    ("1004", "Real Bairro", "RLB", "Campo do Bairro", 0x7C3AED, 0xF5C542),
    ("1005", "Sporting Sul", "SPS", "Arena Sul", 0x0E2A47, 0x22D3EE),
    ("1006", "Grêmio Norte", "GRN", "Baixada Norte", 0x0F766E, 0xF8FAFC),
    ("1007", "Independente Leste", "INL", "Praça Leste", 0xEA580C, 0x111827),
    ("1008", "Náutico Oeste", "NTO", "Maré Oeste", 0xFACC15, 0x15803D),
]

POSITIONS = ["goleiro", "defensor", "defensor", "meio", "meio", "atacante", "atacante", "defensor", "meio", "atacante", "defensor"]

FIRST = ["Gabriel", "Rafael", "Lucas", "Matheus", "Pedro", "Thiago", "Bruno", "Vinicius", "Eduardo", "Caio", "Igor", "Fernando"]
LAST = ["Martins", "Silva", "Souza", "Oliveira", "Costa", "Almeida", "Rocha", "Barbosa", "Ribeiro", "Carvalho", "Gomes", "Araujo"]


class Api:
    def __init__(self, base: str, key: str) -> None:
        self.base, self.key = base.rstrip("/"), key

    def _call(self, method: str, path: str, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"X-API-Key": self.key, "Content-Type": "application/json"}
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            raise RuntimeError(f"{method} {path} -> {e.code} {body}") from None

    def sync(self, action: str, payload: dict):
        return self._call("POST", "/sync", {"action": action, "payload": payload})

    def post(self, path: str, payload: dict):
        return self._call("POST", path, payload)

    def get(self, path: str):
        return self._call("GET", path)


def make_players(club_id: str) -> list[dict]:
    players = []
    for i in range(11):
        pos = POSITIONS[i]
        name = random.choice(FIRST).lower() + str(random.randint(1, 99))
        players.append({
            "player_id": f"{club_id}9{i:02d}",
            "gamertag": name,
            "posicao": pos,
            "overall": random.randint(70, 86),
            "nome": f"{random.choice(FIRST)} {random.choice(LAST)}",
        })
    return players


def player_line(player: dict, goals: int, conceded: int, won: bool) -> dict:
    is_gk = player["posicao"] == "goleiro"
    base = 6.2 + (player["overall"] - 74) * 0.06 + (0.55 if won else -0.3)
    pgoals = 0
    if not is_gk and goals > 0:
        pgoals = random.randint(0, goals)
    rating = min(10.0, max(4.0, base + pgoals * 0.85 + (0.5 if is_gk and conceded == 0 else 0)))
    line = {
        "club_id": "",
        "player_id": player["player_id"],
        "gamertag": player["gamertag"],
        "posicao": player["posicao"],
        "nota": round(rating, 2),
        "gols": pgoals,
        "assistencias": random.randint(0, 2) if not is_gk else 0,
        "chutes": random.randint(0, 4) if not is_gk else 0,
        "passes_certos": random.randint(8, 40),
        "passes_tentados": random.randint(40, 55),
        "desarmes_certos": random.randint(0, 6),
        "desarmes_tentados": random.randint(6, 14),
        "defesas": random.randint(1, 6) if is_gk else 0,
        "segundos_jogados": random.randint(540, 660),
        "melhor_em_campo": False,
        "cartao_vermelho": False,
        "jogo_sem_sofrer_gol": conceded == 0,
    }
    if is_gk:
        line["defesas_por_tipo"] = {
            "ballDiveSaves": random.randint(0, 3),
            "crossSaves": random.randint(0, 2),
            "parrySaves": random.randint(0, 2),
            "punchSaves": random.randint(0, 1),
            "reflexSaves": random.randint(0, 3),
            "goodDirectionSaves": random.randint(0, 2),
        }
    return line


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--key", default="devkey")
    args = ap.parse_args()
    api = Api(args.api, args.key)

    squads = {cid: make_players(cid) for cid, *_ in CLUBS}

    # --- clubes + totais -------------------------------------------------
    for cid, nome, sigla, stad, c1, c2 in CLUBS:
        api.sync("club.upsert", {
            "club_id": cid, "nome": nome, "sigla": sigla, "estadio": stad,
            "regiao_id": "1000000", "time_id": "100",
            "cor_1": c1, "cor_2": c2, "cor_3": 0x0B1F14, "cor_4": c2,
            "acompanhado": True,
        })

    # --- calendário: cada clube joga a cada ~4 dias ----------------------
    now = datetime.now(tz=timezone.utc)
    match_seq = 0
    for md in range(24):
        order = CLUBS[:]
        random.shuffle(order)
        ts = now - timedelta(days=(24 - md) * 4, hours=random.randint(0, 6))
        for i in range(0, len(order), 2):
            home, away = order[i], order[i + 1]
            match_seq += 1
            hg = max(0, int(random.gauss(2.0, 1.4)))
            ag = max(0, int(random.gauss(1.4, 1.2)))
            tipo = "amistoso" if md % 6 == 5 else "liga"
            result = "vitoria" if hg > ag else "derrota" if hg < ag else "empate"

            lines = []
            for p in squads[home[0]]:
                ln = player_line(p, hg, ag, hg > ag)
                ln["club_id"] = home[0]
                lines.append(ln)
            for p in squads[away[0]]:
                ln = player_line(p, ag, hg, ag > hg)
                ln["club_id"] = away[0]
                lines.append(ln)
            if lines:
                best = max(lines, key=lambda x: x["nota"])
                best["melhor_em_campo"] = True

            api.sync("partida.upsert", {
                "match_id": f"9000000{match_seq:05d}",
                "timestamp": ts.isoformat().replace("+00:00", "Z"),
                "tipo": tipo,
                "clube_casa_id": home[0],
                "clube_fora_id": away[0],
                "gols_casa": hg,
                "gols_fora": ag,
                "resultado_casa": result,
                "jogadores": lines,
            })

    # --- totais (all-time inflado) + snapshots ---------------------------
    for idx, (cid, nome, *_rest) in enumerate(CLUBS):
        nivel = 1150 + idx * 40 + random.randint(-30, 60)
        wins = random.randint(20, 60)
        draws = random.randint(5, 20)
        losses = random.randint(5, 25)
        api.sync("clubetotais.upsert", {
            "club_id": cid, "jogos": wins + draws + losses,
            "vitorias": wins, "empates": draws, "derrotas": losses,
            "gols": random.randint(60, 140), "gols_sofridos": random.randint(40, 110),
            "jogos_sem_sofrer": random.randint(2, 18),
            "pontos": wins * 3 + draws,
            "divisao_atual": random.randint(1, 6),
            "melhor_divisao": random.randint(1, 3),
            "nivel": nivel, "promocoes": random.randint(0, 4), "rebaixamentos": random.randint(0, 2),
        })

        # Série histórica: 14 leituras semanais, para o gráfico de evolução e
        # para o diff de divisão terem o que mostrar.
        cur = nivel - 220
        div = min(6, max(1, 7 - idx % 6))
        for w in range(14, 0, -1):
            cur += random.randint(-25, 40)
            if random.random() < 0.18:
                div = max(1, div - 1) if random.random() < 0.6 else min(6, div + 1)
            api.post(f"/clubs/{cid}/snapshots", {
                "club_id": cid, "nivel": cur, "divisao": div,
                "jogos": wins, "vitorias": wins, "empates": draws, "derrotas": losses,
                "gols": random.randint(60, 140), "gols_sofridos": random.randint(40, 110),
                "tamanho_elenco": 11,
            })

    print(f"seed ok: {len(CLUBS)} clubes, {match_seq} partidas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
