"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toPng } from "html-to-image";

// --- 型定義 ---
type GameMode = "score" | "win-loss";
type Player = { id: string; name: string };
type MatchResult = {
  scoreA: number | null;
  scoreB: number | null;
};
type MatchKey = string;

const STORAGE_KEY = "league-app-data";

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

  const updateMatchWinLoss = (
    p1: string,
    p2: string,
    myScore: number,
    oppScore: number,
    isReversed: boolean
  ) => {
    const key = `${p1}-${p2}`;
    const scoreA = isReversed ? oppScore : myScore;
    const scoreB = isReversed ? myScore : oppScore;
    setMatches((prev) => ({ ...prev, [key]: { scoreA, scoreB } }));
  };

  const updateMatchScore = (
    p1: string,
    p2: string,
    isMyScore: boolean,
    value: string,
    isReversed: boolean
  ) => {
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

  // --- 集計 ---
  const calculateStats = useCallback(() => {
    const stats = players.map((player) => {
      let wins = 0,
        losses = 0,
        draws = 0,
        goalsFor = 0,
        goalsAgainst = 0;

      players.forEach((opponent) => {
        if (player.id === opponent.id) return;

        const key1 = `${player.id}-${opponent.id}`;
        const key2 = `${opponent.id}-${player.id}`;

        let sA: number | null = null;
        let sB: number | null = null;

        if (matches[key1]) {
          sA = matches[key1].scoreA;
          sB = matches[key1].scoreB;
        } else if (matches[key2]) {
          sA = matches[key2].scoreB;
          sB = matches[key2].scoreA;
        }

        if (sA === null || sB === null) return;
        if (!Number.isFinite(sA) || !Number.isFinite(sB)) return;

        if (mode === "score") {
          goalsFor += sA;
          goalsAgainst += sB;

          if (sA > sB) wins++;
          else if (sA < sB) losses++;
          else draws++;
        } else {
          if (sA === 1) wins++;
          else if (sA === 0.5) draws++;
          else if (sA === 0) losses++;
        }
      });

      return { ...player, wins, losses, draws, goalsFor, goalsAgainst, goalDiff: goalsFor - goalsAgainst };
    });

    return stats.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (mode === "score" && a.losses !== b.losses) return a.losses - b.losses;

      const keyAB = `${a.id}-${b.id}`;
      const keyBA = `${b.id}-${a.id}`;
      const mAB = matches[keyAB];
      const mBA = matches[keyBA];

      if (mAB && mAB.scoreA !== null && mAB.scoreB !== null) {
        if (mode === "score") {
          if (mAB.scoreA > mAB.scoreB) return -1;
          if (mAB.scoreA < mAB.scoreB) return 1;
        } else {
          if (mAB.scoreA === 1) return -1;
          if (mAB.scoreA === 0) return 1;
        }
      } else if (mBA && mBA.scoreA !== null && mBA.scoreB !== null) {
        if (mode === "score") {
          const aScore = mBA.scoreB;
          const bScore = mBA.scoreA;
          if (aScore > bScore) return -1;
          if (aScore < bScore) return 1;
        } else {
          const aRes = mBA.scoreB;
          if (aRes === 1) return -1;
          if (aRes === 0) return 1;
        }
      }

      if (mode === "score" && a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
      if (mode === "score" && a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
      return 0;
    });
  }, [players, matches, mode]);

  const rankedPlayers = useMemo(() => calculateStats(), [calculateStats]);

  const hasMatches = useMemo(
    () => Object.values(matches).some((m) => m.scoreA !== null && m.scoreB !== null),
    [matches]
  );

  // --- 対戦スケジュール生成（サークル法） ---
  const schedule = useMemo(() => {
    if (players.length < 2) return [];

    const ps = [...players];
    if (ps.length % 2 !== 0) ps.push({ id: "dummy", name: "休み" });

    const n = ps.length;
    const rounds = n - 1;
    const half = n / 2;
    const matchesList: { no: number; p1: Player; p2: Player }[] = [];

    const fixed = ps[0];
    const rotating = ps.slice(1);
    let matchCount = 1;

    for (let r = 0; r < rounds; r++) {
      const pA = fixed;
      const pB = rotating[rotating.length - 1];
      if (pA.id !== "dummy" && pB.id !== "dummy") matchesList.push({ no: matchCount++, p1: pA, p2: pB });

      for (let i = 0; i < half - 1; i++) {
        const p1 = rotating[i];
        const p2 = rotating[rotating.length - 2 - i];
        if (p1.id !== "dummy" && p2.id !== "dummy") matchesList.push({ no: matchCount++, p1, p2 });
      }

      const last = rotating.pop();
      if (last) rotating.unshift(last);
    }

    return matchesList;
  }, [players]);

  const matchOrderMap = useMemo(() => {
    const map: Record<string, number> = {};
    schedule.forEach((m) => {
      map[`${m.p1.id}-${m.p2.id}`] = m.no;
      map[`${m.p2.id}-${m.p1.id}`] = m.no;
    });
    return map;
  }, [schedule]);

  // ★主目的：ズーム/スマホでも見切れない画像出力
  // 方針：表示中DOMを直接撮らず、「画像出力用のクローンDOM」を画面外に作ってそれを撮る
  const saveImage = async () => {
    if (!tableRef.current) return;

    const root = tableRef.current;

    // 元のテーブルの「本当の横幅」
    const srcTable = root.querySelector("table") as HTMLTableElement | null;
    const tableFullWidth = srcTable ? srcTable.scrollWidth : root.scrollWidth;

    // 余白込みで少し広げる
    const targetWidth = Math.max(root.scrollWidth, tableFullWidth) + 40;

    // 1) 出力用クローンを作る（ここがズーム耐性の肝）
    const exportNode = root.cloneNode(true) as HTMLDivElement;

    // 2) 画面外に配置（表示はしないが、レイアウト計算はさせる）
    exportNode.style.position = "fixed";
    exportNode.style.left = "-100000px";
    exportNode.style.top = "0";
    exportNode.style.background = "#ffffff";
    exportNode.style.width = `${targetWidth}px`;
    exportNode.style.maxWidth = "none";
    exportNode.style.transform = "none";
    exportNode.style.pointerEvents = "none";

    // 3) 横スクロール容器を無効化（画像では “全部見える” 状態にする）
    const wrappers = exportNode.querySelectorAll(".overflow-x-auto");
    wrappers.forEach((el) => {
      const div = el as HTMLDivElement;
      div.style.overflowX = "visible";
      div.style.overflowY = "visible";
      div.style.maxWidth = "none";
      div.style.width = `${targetWidth}px`;
    });

    // 4) テーブル幅を scrollWidth に固定（w-full だと親幅に吸われることがある）
    const tables = exportNode.querySelectorAll("table");
    tables.forEach((t) => {
      const tbl = t as HTMLTableElement;
      // 総当たり表だけ広げたいが、複数あるので全部に安全側設定
      tbl.style.width = `${Math.max(tableFullWidth, targetWidth - 40)}px`;
      tbl.style.maxWidth = "none";
      tbl.style.tableLayout = "auto";
    });

    document.body.appendChild(exportNode);

    try {
      // レイアウト確定を待つ（これを入れないと幅が反映されない環境がある）
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const exportHeight = exportNode.scrollHeight + 20;

      // Optionsの型問題があるので toPng を any で呼ぶ（構文事故も避けられる）
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
      exportNode.remove();
    }
  };

  const copyToClipboard = () => {
    let text = `【${title}】結果\n\n`;
    rankedPlayers.forEach((p, i) => {
      const rank = i + 1;
      const icon = rank === 1 && hasMatches ? "👑 " : "";
      let line = `${rank}位: ${icon}${p.name} / ${p.wins}勝${p.losses}敗`;
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
                <input type="checkbox" checked={allowDraw} onChange={(e) => setAllowDraw(e.target.checked)} className="w-5 h-5" />
                <span>引き分けあり</span>
              </label>
              <p className="text-sm text-gray-500 mt-1 ml-7">
                ※無料版では主に「勝敗のみ」モードの△ボタンに反映します（スコア入力は同点が入り得ます）。
              </p>
            </div>

            <div>
              <h2 className="font-bold mb-2">3. 表示設定</h2>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showOrder} onChange={(e) => setShowOrder(e.target.checked)} className="w-5 h-5" />
                <span>対戦順（スケジュール）を表示する</span>
              </label>
              <p className="text-sm text-gray-500 mt-1 ml-7">総当たり表に試合番号を表示し、進行リストを作成します。</p>
            </div>

            <button onClick={() => setPhase("register")} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">
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
              <button onClick={() => setPhase("match")} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">
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
                  <h3 className="font-bold text-lg mb-2">試合スケジュール</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    {schedule.map((m) => {
                      const key = `${m.p1.id}-${m.p2.id}`;
                      const res = matches[key];
                      const isFinished = res?.scoreA !== null && res?.scoreB !== null;

                      let resultStr = "vs";
                      if (isFinished && res) {
                        if (mode === "score") resultStr = `${res.scoreA} - ${res.scoreB}`;
                        else {
                          const resA = res.scoreA === 1 ? "○" : res.scoreA === 0.5 ? "△" : "●";
                          const resB = res.scoreB === 1 ? "○" : res.scoreB === 0.5 ? "△" : "●";
                          resultStr = `${resA} - ${resB}`;
                        }
                      }

                      return (
                        <div
                          key={m.no}
                          className={`flex items-center gap-2 p-2 rounded ${
                            isFinished ? "bg-gray-200 text-gray-500" : "bg-white border"
                          }`}
                        >
                          <span className="font-bold text-blue-600 w-8">#{m.no}</span>
                          <span className="font-bold">{m.p1.name}</span>
                          <span className="px-2 text-gray-500">{resultStr}</span>
                          <span className="font-bold">{m.p2.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <h3 className="font-bold text-lg mb-2">現在の順位</h3>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-400">
                    <th className="p-2">順位</th>
                    <th className="p-2">名前</th>
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
