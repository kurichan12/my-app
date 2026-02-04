"use client";

import { useState, useRef, useCallback } from "react";
import { toPng } from "html-to-image";

// --- 型定義 ---
type GameMode = "score" | "win-loss";
type Player = { id: string; name: string };
type MatchResult = {
  scoreA: number | null; 
  scoreB: number | null; 
};
type MatchKey = string; 

export default function LeagueApp() {
  // --- 状態管理 ---
  const [phase, setPhase] = useState<"settings" | "register" | "match">("settings");
  
  // ★追加: タイトルの状態
  const [title, setTitle] = useState("総当たりリーグ戦アプリ");
  
  const [mode, setMode] = useState<GameMode>("score");
  const [allowDraw, setAllowDraw] = useState(true);
  const [players, setPlayers] = useState<Player[]>([]);
  const [newName, setNewName] = useState("");
  const [matches, setMatches] = useState<Record<MatchKey, MatchResult>>({});
  
  const tableRef = useRef<HTMLDivElement>(null);

  // --- 1. 参加者登録ロジック ---
  const addPlayer = () => {
    if (!newName.trim()) return;
    if (players.length >= 10) return alert("最大10人までです");
    setPlayers([...players, { id: crypto.randomUUID(), name: newName }]);
    setNewName("");
  };

  const removePlayer = (id: string) => {
    setPlayers(players.filter((p) => p.id !== id));
  };

  // --- 2. 試合結果更新ロジック ---
  const updateMatchWinLoss = (p1: string, p2: string, myScore: number, oppScore: number, isReversed: boolean) => {
    const key = `${p1}-${p2}`;
    const scoreA = isReversed ? oppScore : myScore;
    const scoreB = isReversed ? myScore : oppScore;

    setMatches(prev => ({
        ...prev,
        [key]: { scoreA, scoreB }
    }));
  };

  const updateMatchScore = (p1: string, p2: string, isMyScore: boolean, value: string, isReversed: boolean) => {
    const key = `${p1}-${p2}`;
    let val: number | null = value === "" ? null : Number(value);

    setMatches(prev => {
        const current = prev[key] || { scoreA: null, scoreB: null };
        let targetField: "scoreA" | "scoreB";

        if (!isReversed) {
            targetField = isMyScore ? "scoreA" : "scoreB";
        } else {
            targetField = isMyScore ? "scoreB" : "scoreA";
        }

        const updated = { ...current, [targetField]: val };
        return { ...prev, [key]: updated };
    });
  };

  // --- 3. 集計・順位付けロジック ---
  const calculateStats = useCallback(() => {
    const stats = players.map((player) => {
      let wins = 0;
      let losses = 0;
      let draws = 0;
      let goalsFor = 0;
      let goalsAgainst = 0;

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

        if (sA !== null && sB !== null) {
          if (mode === "score") {
            goalsFor += sA;
            goalsAgainst += sB;
            if (sA > sB) wins++;
            else if (sA < sB) losses++;
            else draws++;
          } else {
            if (sA === 1) wins++;
            else if (sA === 0 && sB === 1) losses++;
            else if (sA === 0.5) draws++;
          }
        }
      });

      return {
        ...player,
        wins,
        losses,
        draws,
        goalsFor,
        goalDiff: goalsFor - goalsAgainst,
      };
    });

    return stats.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (mode === "score" && a.losses !== b.losses) return a.losses - b.losses;

      const keyDirect = `${a.id}-${b.id}`;
      const matchDirect = matches[keyDirect] || matches[`${b.id}-${a.id}`];
      if (matchDirect) {
          if (matches[`${a.id}-${b.id}`]) {
            const mA = matches[`${a.id}-${b.id}`];
            if (mA.scoreA !== null && mA.scoreB !== null) {
                 if (mA.scoreA > mA.scoreB) return -1;
                 if (mA.scoreB > mA.scoreA) return 1;
            }
          } 
          else if (matches[`${b.id}-${a.id}`]) {
             const mB = matches[`${b.id}-${a.id}`];
             if (mB.scoreA !== null && mB.scoreB !== null) {
                 if (mB.scoreB > mB.scoreA) return -1;
                 if (mB.scoreA > mB.scoreB) return 1;
             }
          }
      }

      if (mode === "score" && a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
      if (mode === "score" && a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
      return 0;
    });
  }, [players, matches, mode]);

  const rankedPlayers = calculateStats();
  const hasMatches = Object.values(matches).some(m => m.scoreA !== null);

  const saveImage = () => {
    if (tableRef.current === null) return;
    toPng(tableRef.current, { cacheBust: true, backgroundColor: '#ffffff' })
      .then((dataUrl) => {
        const link = document.createElement("a");
        // ★変更: ファイル名をタイトルに合わせる
        link.download = `${title || "league-result"}.png`;
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => console.error(err));
  };

  return (
    <div className="min-h-screen p-8 bg-gray-50 text-gray-800 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-lg">
        {/* ★変更: タイトルを入力可能に */}
        <div className="border-b pb-4 mb-6">
            <input 
                type="text" 
                value={title} 
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-2xl font-bold text-center border-none focus:ring-2 focus:ring-blue-300 rounded p-1"
                placeholder="タイトルを入力（例：第1回〇〇杯）"
            />
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
            </div>
            <button onClick={() => setPhase("register")} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">次へ：参加者登録</button>
          </div>
        )}

        {phase === "register" && (
          <div className="space-y-6">
             <div className="flex justify-between items-center">
                <h2 className="font-bold text-xl">参加者登録 ({players.length}/10)</h2>
                <button onClick={() => setPhase("settings")} className="text-sm text-gray-500 underline">設定に戻る</button>
             </div>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={newName} 
                onChange={(e) => setNewName(e.target.value)} 
                placeholder="名前を入力"
                className="flex-1 border p-2 rounded"
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <button onClick={addPlayer} className="bg-green-600 text-white px-4 py-2 rounded font-bold">追加</button>
            </div>
            <ul className="space-y-2">
              {players.map((p, idx) => (
                <li key={p.id} className="flex justify-between items-center bg-gray-100 p-3 rounded">
                  <span>{idx + 1}. {p.name}</span>
                  <button onClick={() => removePlayer(p.id)} className="text-red-500 text-sm">削除</button>
                </li>
              ))}
              {players.length === 0 && <p className="text-gray-400 text-center py-4">参加者がいません</p>}
            </ul>
            {players.length >= 2 && (
              <button onClick={() => setPhase("match")} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">対戦開始！</button>
            )}
          </div>
        )}

        {phase === "match" && (
          <div className="space-y-8">
            <div className="flex justify-between items-center print:hidden">
                <button onClick={() => setPhase("register")} className="text-sm text-gray-500 underline">← メンバー変更に戻る</button>
                <button onClick={saveImage} className="bg-indigo-600 text-white px-4 py-2 rounded shadow">画像として保存</button>
            </div>

            <div ref={tableRef} className="p-4 bg-white">
                {/* ★変更: 印刷/画像化用エリアにもタイトルを表示 */}
                <h2 className="text-center font-bold text-2xl mb-4 break-words">{title}</h2>
                
                <div className="overflow-x-auto mb-8">
                  <table className="w-full border-collapse border border-gray-300 text-sm md:text-base">
                    <thead>
                      <tr>
                        <th className="border p-2 bg-gray-100"></th>
                        {players.map(p => <th key={p.id} className="border p-2 bg-gray-50 min-w-[60px]">{p.name}</th>)}
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

                            return (
                              <td key={colPlayer.id} className="border p-2 text-center min-w-[100px]">
                                {mode === "score" ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <input 
                                      type="number" 
                                      className="w-10 border text-center p-1 rounded" 
                                      value={myScore ?? ""} 
                                      onChange={(e) => updateMatchScore(p1.id, p2.id, true, e.target.value, isReversed)}
                                    />
                                    <span>-</span>
                                    <input 
                                      type="number" 
                                      className="w-10 border text-center p-1 rounded" 
                                      value={oppScore ?? ""} 
                                      onChange={(e) => updateMatchScore(p1.id, p2.id, false, e.target.value, isReversed)}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex justify-center gap-1">
                                    <button 
                                        onClick={() => updateMatchWinLoss(p1.id, p2.id, 1, 0, isReversed)}
                                        className={`w-8 h-8 rounded-full border transition-all ${myScore === 1 
                                            ? 'bg-red-500 text-white border-red-600 scale-110 shadow-md' 
                                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                    >○</button>
                                    
                                    {allowDraw && (
                                        <button 
                                            onClick={() => updateMatchWinLoss(p1.id, p2.id, 0.5, 0.5, isReversed)}
                                            className={`w-8 h-8 rounded-full border transition-all ${myScore === 0.5 
                                                ? 'bg-green-500 text-white border-green-600 scale-110 shadow-md' 
                                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                        >△</button>
                                    )}

                                    <button 
                                        onClick={() => updateMatchWinLoss(p1.id, p2.id, 0, 1, isReversed)}
                                        className={`w-8 h-8 rounded-full border transition-all ${myScore === 0 
                                            ? 'bg-blue-500 text-white border-blue-600 scale-110 shadow-md' 
                                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                    >●</button>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

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
                            <tr key={p.id} className={`border-b ${i === 0 && hasMatches ? 'bg-yellow-50 font-bold' : ''}`}>
                                <td className="p-2 text-lg">{i + 1}</td>
                                <td className="p-2">{p.name} {i === 0 && hasMatches && "👑"}</td>
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
          </div>
        )}
      </div>
    </div>
  );
}