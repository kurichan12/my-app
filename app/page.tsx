"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toPng } from "html-to-image";

// --- 型定義 ---
type GameMode = "score" | "win-loss";
type Player = { id: string; name: string };
type MatchResult = { scoreA: number | null; scoreB: number | null };
type MatchKey = string;

const STORAGE_KEY = "league-app-data";
const DUMMY_ID = "dummy";

// 勝点（一般的）
const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const POINTS_LOSS = 0;

type ScheduledMatch = {
  no: number | null; // 実試合のみ番号を振る（BYEはnull）
  p1: Player;
  p2: Player; // dummy の場合あり
  isBye: boolean;
};

type RoundSchedule = {
  roundNo: number; // 1戦目,2戦目...
  matches: ScheduledMatch[]; // 実試合 + BYE
};

type Stats = Player & {
  played: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;     // score のみ意味あり
  goalsAgainst: number; // score のみ意味あり
  goalDiff: number;     // score のみ意味あり
};

export default function LeagueApp() {
  // --- 状態管理 ---
  const [isLoaded, setIsLoaded] = useState(false);
  const [phase, setPhase] = useState<"settings" | "register" | "match">("settings");
  const [title, setTitle] = useState("第◯回 〇〇大会 ◯ブロック");
  const [mode, setMode] = useState<GameMode>("score");
  const [allowDraw, setAllowDraw] = useState(true);
  const [showOrder, setShowOrder] = useState(false);

  const [players, setPlayers] = useState<Player[]>([]);
  const [newName, setNewName] = useState("");
  const [matches, setMatches] = useState<Record<MatchKey, MatchResult>>({});

  const tableRef = useRef<HTMLDivElement>(null);

  // --- データのロード ---
  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);

        setTitle(typeof parsed.title === "string" ? parsed.title : "第◯回 〇〇大会 ◯ブロック");
        setMode(parsed.mode === "score" || parsed.mode === "win-loss" ? parsed.mode : "score");
        setAllowDraw(typeof parsed.allowDraw === "boolean" ? parsed.allowDraw : true);
        setShowOrder(typeof parsed.showOrder === "boolean" ? parsed.showOrder : false);
        setPlayers(Array.isArray(parsed.players) ? parsed.players : []);
        setMatches(parsed.matches && typeof parsed.matches === "object" ? parsed.matches : {});
        setPhase(
          parsed.phase === "settings" || parsed.phase === "register" || parsed.phase === "match"
            ? parsed.phase
            : "settings"
        );
      } catch (e) {
        console.error("保存データの読み込みに失敗しました", e);
      }
    }
    setIsLoaded(true);
  }, []);

  // --- データの自動保存 ---
  useEffect(() => {
    if (!isLoaded) return;
    const data = { title, mode, allowDraw, showOrder, players, matches, phase };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [title, mode, allowDraw, showOrder, players, matches, phase, isLoaded]);

  // --- ユーティリティ：スコア入力の安全化 ---
  const parseScore = (value: string): number | null => {
    if (value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return null;
    return Math.floor(n);
  };

  // --- ロジック群 ---
  const addPlayer = () => {
    const name = newName.trim();
    if (!name) return;
    if (players.length >= 10) return alert("最大10人までです");

    const dup = players.some((p) => p.name.trim() === name);
    if (dup) alert("同じ名前が既にあります（運用上紛らわしいので注意）");

    setPlayers([...players, { id: crypto.randomUUID(), name }]);
    setNewName("");
  };

  // プレイヤー削除時に matches の残骸も掃除
  const removePlayer = (id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id));

    setMatches((prev) => {
      const next: Record<string, MatchResult> = {};
      for (const [k, v] of Object.entries(prev)) {
        const [a, b] = k.split("-");
        if (a === id || b === id) continue;
        next[k] = v;
      }
      return next;
    });
  };

  const updateMatchWinLoss = (p1: string, p2: string, myScore: number, oppScore: number, isReversed: boolean) => {
    const key = `${p1}-${p2}`;
    const scoreA = isReversed ? oppScore : myScore;
    const scoreB = isReversed ? myScore : oppScore;
    setMatches((prev) => ({ ...prev, [key]: { scoreA, scoreB } }));
  };

  const updateMatchScore = (p1: string, p2: string, isMyScore: boolean, value: string, isReversed: boolean) => {
    const key = `${p1}-${p2}`;
    const val = parseScore(value);

    setMatches((prev) => {
      const current = prev[key] || { scoreA: null, scoreB: null };

      let targetField: "scoreA" | "scoreB";
      if (!isReversed) targetField = isMyScore ? "scoreA" : "scoreB";
      else targetField = isMyScore ? "scoreB" : "scoreA";

      const updated = { ...current, [targetField]: val };
      return { ...prev, [key]: updated };
    });
  };

  // ★重要：試合結果取得を共通化（p1-p2 / p2-p1 両対応）
  // 戻り値は「p1視点」に正規化：{ a: p1の値, b: p2の値 }
  const getMatchAB = useCallback(
    (p1Id: string, p2Id: string): { a: number | null; b: number | null } | null => {
      const key12 = `${p1Id}-${p2Id}`;
      const key21 = `${p2Id}-${p1Id}`;

      const m12 = matches[key12];
      if (m12) return { a: m12.scoreA, b: m12.scoreB };

      const m21 = matches[key21];
      if (m21) return { a: m21.scoreB, b: m21.scoreA };

      return null;
    },
    [matches]
  );

  // ★試合が「確定」と言えるか（allowDraw=false 時の同点は未確定扱い）
  const isConfirmed = useCallback(
    (p1Id: string, p2Id: string) => {
      const ab = getMatchAB(p1Id, p2Id);
      if (!ab) return false;
      if (ab.a === null || ab.b === null) return false;

      if (mode === "score") {
        // 引き分け禁止なら同点は未確定
        if (!allowDraw && ab.a === ab.b) return false;
        return true;
      }

      // win-loss は 1/0.5/0 の前提。allowDraw=false ならUIで0.5が入らない想定だが、
      // 保存データに残っていたら未確定扱いにしておく。
      if (!allowDraw && ab.a === 0.5) return false;
      return true;
    },
    [getMatchAB, mode, allowDraw]
  );

  // ★勝点計算（p1視点）
  const calcPointsForP1 = useCallback(
    (a: number, b: number): number => {
      if (mode === "score") {
        if (a > b) return POINTS_WIN;
        if (a < b) return POINTS_LOSS;
        // 同点
        return allowDraw ? POINTS_DRAW : 0; // allowDraw=false なら本来ここに来ない（未確定扱い）
      } else {
        // win-loss：a=1(勝),0.5(分),0(負)
        if (a === 1) return POINTS_WIN;
        if (a === 0.5) return allowDraw ? POINTS_DRAW : 0;
        return POINTS_LOSS;
      }
    },
    [mode, allowDraw]
  );

  // ★一般的な順位用：直接対決（勝点）で比較
  const headToHeadCompare = useCallback(
    (aId: string, bId: string): number => {
      if (!isConfirmed(aId, bId)) return 0;

      const ab = getMatchAB(aId, bId);
      if (!ab || ab.a === null || ab.b === null) return 0;

      const pA = calcPointsForP1(ab.a, ab.b);
      const pB = calcPointsForP1(ab.b, ab.a); // 反転してBの勝点
      if (pA !== pB) return pB - pA; // 降順にしたいので「b - a」じゃなく比較用に返す
      return 0;
    },
    [getMatchAB, isConfirmed, calcPointsForP1]
  );

  // --- 集計（一般的：勝点ベース） ---
  const calculateStats = useCallback((): Stats[] => {
    const stats: Stats[] = players.map((p) => ({
      ...p,
      played: 0,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
    }));

    const idx = new Map<string, number>();
    stats.forEach((p, i) => idx.set(p.id, i));

    // 全組み合わせを走査（重複計算を避ける）
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const A = players[i];
        const B = players[j];

        if (!isConfirmed(A.id, B.id)) continue;

        const ab = getMatchAB(A.id, B.id);
        if (!ab || ab.a === null || ab.b === null) continue;

        const a = ab.a;
        const b = ab.b;

        const ai = idx.get(A.id)!;
        const bi = idx.get(B.id)!;

        stats[ai].played += 1;
        stats[bi].played += 1;

        // 勝敗・勝点
        const pA = calcPointsForP1(a, b);
        const pB = calcPointsForP1(b, a);
        stats[ai].points += pA;
        stats[bi].points += pB;

        if (pA === POINTS_WIN) {
          stats[ai].wins += 1;
          stats[bi].losses += 1;
        } else if (pA === POINTS_DRAW) {
          stats[ai].draws += 1;
          stats[bi].draws += 1;
        } else {
          stats[ai].losses += 1;
          stats[bi].wins += 1;
        }

        // score方式なら得点も反映
        if (mode === "score") {
          stats[ai].goalsFor += a;
          stats[ai].goalsAgainst += b;
          stats[bi].goalsFor += b;
          stats[bi].goalsAgainst += a;
        }
      }
    }

    // 差分を更新
    stats.forEach((p) => {
      p.goalDiff = p.goalsFor - p.goalsAgainst;
    });

    // 並べ替え（一般的な優先順）
    stats.sort((A, B) => {
      // 1) 勝点
      if (A.points !== B.points) return B.points - A.points;

      // 2) 直接対決（勝点）
      const h2h = headToHeadCompare(A.id, B.id);
      if (h2h !== 0) return h2h;

      if (mode === "score") {
        // 3) 得失点差
        if (A.goalDiff !== B.goalDiff) return B.goalDiff - A.goalDiff;
        // 4) 総得点
        if (A.goalsFor !== B.goalsFor) return B.goalsFor - A.goalsFor;
        // 5) 勝数（最後の最後）
        if (A.wins !== B.wins) return B.wins - A.wins;
      } else {
        // win-loss は得点が無いので勝数・敗数
        if (A.wins !== B.wins) return B.wins - A.wins;
        if (A.losses !== B.losses) return A.losses - B.losses; // 負けが少ない方が上
      }

      // 最後：名前（安定ソート）
      return A.name.localeCompare(B.name, "ja");
    });

    return stats;
  }, [players, mode, isConfirmed, getMatchAB, calcPointsForP1, headToHeadCompare]);

  const rankedPlayers = useMemo(() => calculateStats(), [calculateStats]);

  const hasMatches = useMemo(
    () => Object.values(matches).some((m) => m.scoreA !== null && m.scoreB !== null),
    [matches]
  );

  // --- 対戦スケジュール生成（サークル法 / ラウンド単位） ---
  const roundSchedule: RoundSchedule[] = useMemo(() => {
    if (players.length < 2) return [];

    const ps = [...players];
    if (ps.length % 2 !== 0) ps.push({ id: DUMMY_ID, name: "休み" });

    const n = ps.length;
    const rounds = n - 1;
    const half = n / 2;

    const fixed = ps[0];
    const rotating = ps.slice(1);

    let matchCount = 1;
    const result: RoundSchedule[] = [];

    for (let r = 0; r < rounds; r++) {
      const roundNo = r + 1;
      const matchesInRound: ScheduledMatch[] = [];

      {
        const pA = fixed;
        const pB = rotating[rotating.length - 1];
        const isBye = pA.id === DUMMY_ID || pB.id === DUMMY_ID;
        const no = isBye ? null : matchCount++;
        matchesInRound.push({ no, p1: pA, p2: pB, isBye });
      }

      for (let i = 0; i < half - 1; i++) {
        const p1 = rotating[i];
        const p2 = rotating[rotating.length - 2 - i];
        const isBye = p1.id === DUMMY_ID || p2.id === DUMMY_ID;
        const no = isBye ? null : matchCount++;
        matchesInRound.push({ no, p1, p2, isBye });
      }

      // BYEは dummy を後ろへ
      matchesInRound.forEach((m) => {
        if (!m.isBye) return;
        if (m.p1.id === DUMMY_ID && m.p2.id !== DUMMY_ID) {
          const tmp = m.p1;
          m.p1 = m.p2;
          m.p2 = tmp;
        }
      });

      const realMatches = matchesInRound.filter((m) => !m.isBye);
      const byes = matchesInRound.filter((m) => m.isBye);

      result.push({ roundNo, matches: [...realMatches, ...byes] });

      const last = rotating.pop();
      if (last) rotating.unshift(last);
    }

    return result;
  }, [players]);

  const matchOrderMap = useMemo(() => {
    const map: Record<string, number> = {};
    roundSchedule.forEach((round) => {
      round.matches.forEach((m) => {
        if (m.isBye || m.no === null) return;
        map[`${m.p1.id}-${m.p2.id}`] = m.no;
        map[`${m.p2.id}-${m.p1.id}`] = m.no;
      });
    });
    return map;
  }, [roundSchedule]);

  // ★画像出力（完成版を維持）
  const saveImage = async () => {
    if (!tableRef.current) return;

    const root = tableRef.current;

    const srcTable = root.querySelector("table") as HTMLTableElement | null;
    const tableFullWidth = srcTable ? srcTable.scrollWidth : root.scrollWidth;
    const targetWidth = Math.max(root.scrollWidth, tableFullWidth) + 40;

    const exportWrapper = document.createElement("div");
    exportWrapper.style.position = "fixed";
    exportWrapper.style.left = "0";
    exportWrapper.style.top = "0";
    exportWrapper.style.opacity = "0";
    exportWrapper.style.pointerEvents = "none";
    exportWrapper.style.zIndex = "-1";
    exportWrapper.style.background = "#ffffff";

    const exportNode = root.cloneNode(true) as HTMLDivElement;
    exportNode.style.width = `${targetWidth}px`;
    exportNode.style.maxWidth = "none";
    exportNode.style.background = "#ffffff";

    const inputs = exportNode.querySelectorAll("input");
    inputs.forEach((el) => {
      const input = el as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio") return;
      input.setAttribute("value", input.value ?? "");
    });

    const wrappers = exportNode.querySelectorAll(".overflow-x-auto");
    wrappers.forEach((el) => {
      const div = el as HTMLDivElement;
      div.style.overflowX = "visible";
      div.style.overflowY = "visible";
      div.style.maxWidth = "none";
      div.style.width = `${targetWidth}px`;
    });

    const tables = exportNode.querySelectorAll("table");
    tables.forEach((t) => {
      const tbl = t as HTMLTableElement;
      tbl.style.width = `${Math.max(tableFullWidth, targetWidth - 40)}px`;
      tbl.style.maxWidth = "none";
      tbl.style.tableLayout = "auto";
    });

    exportWrapper.appendChild(exportNode);
    document.body.appendChild(exportWrapper);

    try {
      const fontsAny = (document as any).fonts;
      if (fontsAny?.ready) await fontsAny.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const exportHeight = exportNode.scrollHeight + 20;

      const dataUrl: string = await (toPng as any)(exportNode, {
        cacheBust: true,
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        width: targetWidth,
        height: exportHeight,
        style: {
          width: `${targetWidth}px`,
          height: `${exportHeight}px`,
          maxWidth: "none",
          transform: "none",
        },
      });

      const link = document.createElement("a");
      link.download = `${title}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      alert("画像保存に失敗しました（端末やブラウザによって制限がある場合があります）");
    } finally {
      exportWrapper.remove();
    }
  };

  const copyToClipboard = () => {
    let text = `【${title}】結果\n\n`;
    rankedPlayers.forEach((p, i) => {
      const rank = i + 1;
      const icon = rank === 1 && hasMatches ? "👑 " : "";
      let line = `${rank}位: ${icon}${p.name} / 勝点${p.points} / ${p.wins}勝${p.losses}敗`;
      if (allowDraw) line += `${p.draws}分`;
      if (mode === "score") line += ` (得失点:${p.goalDiff > 0 ? "+" : ""}${p.goalDiff})`;
      text += line + "\n";
    });

    navigator.clipboard
      .writeText(text)
      .then(() => alert("結果をコピーしました！"))
      .catch((err) => console.error(err));
  };

  const resetData = () => {
    if (!confirm("【注意】\n本当に全てのデータを削除しますか？\nこの操作は取り消せません。")) return;
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  if (!isLoaded) return <div className="p-8 text-center">読み込み中...</div>;

  return (
    <div className="min-h-screen p-8 bg-gray-50 text-gray-800 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-lg">
        <div className="border-b pb-4 mb-6 flex justify-between items-center gap-4">
          {phase === "match" ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 text-2xl font-bold text-center border-b-2 border-blue-200 focus:border-blue-500 focus:outline-none py-1"
              placeholder="大会名を入力"
            />
          ) : (
            <h1 className="flex-1 text-2xl font-bold text-center">総当たりリーグ戦アプリ</h1>
          )}
        </div>

        {phase === "settings" && (
          <div className="space-y-6">
            <div>
              <h2 className="font-bold mb-2">1. 対戦形式</h2>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer border p-4 rounded-lg has-[:checked]:bg-blue-50 has-[:checked]:border-blue-500">
                  <input type="radio" checked={mode === "score"} onChange={() => setMode("score")} />
                  <div>
                    <div className="font-bold">スコア入力式</div>
                    <div className="text-sm text-gray-500">得点数を入力</div>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer border p-4 rounded-lg has-[:checked]:bg-blue-50 has-[:checked]:border-blue-500">
                  <input type="radio" checked={mode === "win-loss"} onChange={() => setMode("win-loss")} />
                  <div>
                    <div className="font-bold">勝敗のみ</div>
                    <div className="text-sm text-gray-500">勝ち・負けのみ</div>
                  </div>
                </label>
              </div>
            </div>

            <div>
              <h2 className="font-bold mb-2">2. 引き分け</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowDraw}
                  onChange={(e) => setAllowDraw(e.target.checked)}
                  className="w-5 h-5"
                />
                <span>引き分けあり</span>
              </label>
              <p className="text-sm text-gray-500 mt-1 ml-7">
                ※引き分けなしの場合、scoreモードで同点入力の試合は「未確定扱い」（順位に反映しません）。
              </p>
            </div>

            <div>
              <h2 className="font-bold mb-2">3. 表示設定</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showOrder}
                  onChange={(e) => setShowOrder(e.target.checked)}
                  className="w-5 h-5"
                />
                <span>対戦順（スケジュール）を表示する</span>
              </label>
              <p className="text-sm text-gray-500 mt-1 ml-7">
                総当たり表に試合番号を表示し、下に「1戦目…」の進行リストを出します。奇数人数の場合は休みも表示します。
              </p>
            </div>

            <button
              onClick={() => setPhase("register")}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700"
            >
              次へ：参加者登録
            </button>

            <div className="flex justify-end pt-8">
              <button onClick={resetData} className="text-xs text-gray-300 hover:text-red-500 transition-colors">
                データをリセット
              </button>
            </div>
          </div>
        )}

        {phase === "register" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-xl">参加者登録 ({players.length}/10)</h2>
              <button onClick={() => setPhase("settings")} className="text-sm text-gray-500 underline">
                設定に戻る
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="名前を入力"
                className="flex-1 border p-2 rounded"
                onKeyDown={(e) => e.key === "Enter" && addPlayer()}
              />
              <button onClick={addPlayer} className="bg-green-600 text-white px-4 py-2 rounded font-bold">
                追加
              </button>
            </div>

            <ul className="space-y-2">
              {players.map((p, idx) => (
                <li key={p.id} className="flex justify-between items-center bg-gray-100 p-3 rounded">
                  <span>
                    {idx + 1}. {p.name}
                  </span>
                  <button onClick={() => removePlayer(p.id)} className="text-red-500 text-sm">
                    削除
                  </button>
                </li>
              ))}
              {players.length === 0 && <p className="text-gray-400 text-center py-4">参加者がいません</p>}
            </ul>

            {players.length >= 2 && (
              <button
                onClick={() => setPhase("match")}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700"
              >
                対戦開始！
              </button>
            )}
          </div>
        )}

        {phase === "match" && (
          <div className="space-y-8">
            <div className="flex flex-wrap gap-2 justify-between items-center print:hidden">
              <button onClick={() => setPhase("register")} className="text-sm text-gray-500 underline">
                ← メンバー変更に戻る
              </button>
              <div className="flex gap-2">
                <button onClick={copyToClipboard} className="bg-gray-600 text-white px-4 py-2 rounded shadow hover:bg-gray-700">
                  結果をコピー
                </button>
                <button onClick={saveImage} className="bg-indigo-600 text-white px-4 py-2 rounded shadow hover:bg-indigo-700">
                  画像として保存
                </button>
              </div>
            </div>

            <div ref={tableRef} data-league-capture="root" className="p-4 bg-white">
              <h2 className="text-center font-bold text-2xl mb-4 break-words">{title}</h2>

              <div className="overflow-x-auto mb-8">
                <table className="w-full border-collapse border border-gray-300 text-sm md:text-base">
                  <thead>
                    <tr>
                      <th className="border p-2 bg-gray-100"></th>
                      {players.map((p) => (
                        <th key={p.id} className="border p-2 bg-gray-50 min-w-[60px]">
                          {p.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((rowPlayer, i) => (
                      <tr key={rowPlayer.id}>
                        <th className="border p-2 bg-gray-50">{rowPlayer.name}</th>

                        {players.map((colPlayer, j) => {
                          if (i === j) return <td key={colPlayer.id} className="border p-2 bg-gray-300"></td>;

                          const isReversed = i > j;
                          const p1 = isReversed ? colPlayer : rowPlayer;
                          const p2 = isReversed ? rowPlayer : colPlayer;

                          const key = `${p1.id}-${p2.id}`;
                          const res = matches[key] || { scoreA: null, scoreB: null };

                          const myScore = isReversed ? res.scoreB : res.scoreA;
                          const oppScore = isReversed ? res.scoreA : res.scoreB;

                          const matchNo = showOrder ? matchOrderMap[key] : null;

                          return (
                            <td key={colPlayer.id} className="border p-2 text-center min-w-[100px] relative">
                              {matchNo && (
                                <span className="absolute top-1 left-1 text-[10px] bg-gray-200 text-gray-600 px-1 rounded">
                                  #{matchNo}
                                </span>
                              )}

                              <div className={matchNo ? "mt-4" : ""}>
                                {mode === "score" ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      className="w-10 border text-center p-1 rounded"
                                      value={myScore ?? ""}
                                      onChange={(e) => updateMatchScore(p1.id, p2.id, true, e.target.value, isReversed)}
                                    />
                                    <span>-</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      className="w-10 border text-center p-1 rounded"
                                      value={oppScore ?? ""}
                                      onChange={(e) => updateMatchScore(p1.id, p2.id, false, e.target.value, isReversed)}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex justify-center gap-1">
                                    <button
                                      onClick={() => updateMatchWinLoss(p1.id, p2.id, 1, 0, isReversed)}
                                      className={`w-8 h-8 rounded-full border transition-all ${
                                        myScore === 1
                                          ? "bg-red-500 text-white border-red-600 scale-110 shadow-md"
                                          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                                      }`}
                                    >
                                      ○
                                    </button>

                                    {allowDraw && (
                                      <button
                                        onClick={() => updateMatchWinLoss(p1.id, p2.id, 0.5, 0.5, isReversed)}
                                        className={`w-8 h-8 rounded-full border transition-all ${
                                          myScore === 0.5
                                            ? "bg-green-500 text-white border-green-600 scale-110 shadow-md"
                                            : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                                        }`}
                                      >
                                        △
                                      </button>
                                    )}

                                    <button
                                      onClick={() => updateMatchWinLoss(p1.id, p2.id, 0, 1, isReversed)}
                                      className={`w-8 h-8 rounded-full border transition-all ${
                                        myScore === 0
                                          ? "bg-blue-500 text-white border-blue-600 scale-110 shadow-md"
                                          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                                      }`}
                                    >
                                      ●
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {showOrder && (
                <div className="mb-8 p-4 bg-gray-50 rounded border">
                  <h3 className="font-bold text-lg mb-3">試合スケジュール</h3>

                  <div className="space-y-4">
                    {roundSchedule.map((round) => (
                      <div key={round.roundNo} className="bg-white border rounded p-3">
                        <div className="font-bold text-gray-700 mb-2">{round.roundNo}戦目</div>

                        <div className="space-y-2 text-sm">
                          {round.matches.map((m, idx) => {
                            if (m.isBye) {
                              const restPlayer = m.p1;
                              return (
                                <div
                                  key={`bye-${round.roundNo}-${idx}`}
                                  className="flex items-center gap-2 p-2 rounded bg-yellow-50 border border-yellow-200"
                                >
                                  <span className="font-bold text-yellow-700 w-16">休み</span>
                                  <span className="font-bold">{restPlayer.name}</span>
                                </div>
                              );
                            }

                            const p1 = m.p1;
                            const p2 = m.p2;

                            const ab = getMatchAB(p1.id, p2.id);
                            const confirmed = isConfirmed(p1.id, p2.id);

                            let resultStr = "vs";
                            if (confirmed && ab && ab.a !== null && ab.b !== null) {
                              if (mode === "score") {
                                resultStr = `${ab.a} - ${ab.b}`;
                              } else {
                                const toMark = (x: number) => (x === 1 ? "○" : x === 0.5 ? "△" : "●");
                                resultStr = `${toMark(ab.a)} - ${toMark(ab.b)}`;
                              }
                            } else if (ab && ab.a !== null && ab.b !== null && mode === "score" && !allowDraw && ab.a === ab.b) {
                              // 引き分け禁止で同点が入っている場合：未確定の注意表示
                              resultStr = "同点（未確定）";
                            }

                            return (
                              <div
                                key={`m-${round.roundNo}-${m.no ?? idx}`}
                                className={`flex items-center gap-2 p-2 rounded ${
                                  confirmed ? "bg-gray-200 text-gray-500" : "bg-white border"
                                }`}
                              >
                                <span className="font-bold text-blue-600 w-16">{m.no ? `#${m.no}` : ""}</span>
                                <span className="font-bold">{p1.name}</span>
                                <span className="px-2 text-gray-500">{resultStr}</span>
                                <span className="font-bold">{p2.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h3 className="font-bold text-lg mb-2">現在の順位</h3>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-400">
                    <th className="p-2">順位</th>
                    <th className="p-2">名前</th>
                    <th className="p-2 text-center">試</th>
                    <th className="p-2 text-center">勝点</th>
                    <th className="p-2 text-center">勝</th>
                    <th className="p-2 text-center">負</th>
                    {allowDraw && <th className="p-2 text-center">分</th>}
                    {mode === "score" && (
                      <>
                        <th className="p-2 text-center">得失点</th>
                        <th className="p-2 text-center">総得点</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rankedPlayers.map((p, i) => (
                    <tr key={p.id} className={`border-b ${i === 0 && hasMatches ? "bg-yellow-50 font-bold" : ""}`}>
                      <td className="p-2 text-lg">{i + 1}</td>
                      <td className="p-2">
                        {p.name} {i === 0 && hasMatches && "👑"}
                      </td>
                      <td className="p-2 text-center">{p.played}</td>
                      <td className="p-2 text-center">{p.points}</td>
                      <td className="p-2 text-center">{p.wins}</td>
                      <td className="p-2 text-center">{p.losses}</td>
                      {allowDraw && <td className="p-2 text-center">{p.draws}</td>}
                      {mode === "score" && (
                        <>
                          <td className="p-2 text-center">{p.goalDiff > 0 ? `+${p.goalDiff}` : p.goalDiff}</td>
                          <td className="p-2 text-center">{p.goalsFor}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-4 border-t print:hidden">
              <button onClick={resetData} className="text-xs text-gray-400 underline hover:text-red-600 transition-colors">
                データを全削除してリセット
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
