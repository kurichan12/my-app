"use client";

import { useState, useRef, useCallback } from "react";
import { toPng } from "html-to-image";

// --- 型定義 ---
type GameMode = "score" | "win-loss";
type Player = { id: string; name: string };
type MatchResult = {
  scoreA: number | null; // A(キーの前側)のスコア
  scoreB: number | null; // B(キーの後側)のスコア
};
type MatchKey = string; // "playerIdA-playerIdB" (常に indexが小さい方-大きい方 で管理)

export default function LeagueApp() {
  // --- 状態管理 ---
  const [phase, setPhase] = useState<"settings" | "register" | "match">("settings");
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

  // --- 2. 試合結果更新ロジック (双方向対応版) ---
  
  // 勝敗モード用
  // isReversed: 下側からの入力ならtrue (スコアを逆にして保存する)
  const updateMatchWinLoss = (p1: string, p2: string, myScore: number, oppScore: number, isReversed: boolean) => {
    // 常に「indexが小さい順」などの一意なキーに合わせるため、呼び出し元でp1, p2の順序は固定されている前提
    // isReversed=trueの場合、入力されたのは「下側(p2)の勝ち負け」なので、データ(p1-p2)としては逆にする
    
    const key = `${p1}-${p2}`;
    
    // データとして保存すべき値
    const scoreA = isReversed ? oppScore : myScore;
    const scoreB = isReversed ? myScore : oppScore;

    setMatches(prev => ({
        ...prev,
        [key]: { scoreA, scoreB }
    }));
  };

  // スコアモード用
  const updateMatchScore = (p1: string, p2: string, isMyScore: boolean, value: string, isReversed: boolean) => {
    const key = `${p1}-${p2}`;
    let val: number | null = value === "" ? null : Number(value);

    setMatches(prev => {
        const current = prev[key] || { scoreA: null, scoreB: null };
        
        // どちらのスコアを更新しようとしているか判定
        let targetField: "scoreA" | "scoreB";

        if (!isReversed) {
            // 上側(正位置): myScore=A, oppScore=B
            targetField = isMyScore ? "scoreA" : "scoreB";
        } else {
            // 下側(逆位置): myScore=B, oppScore=A
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
        
        // データが存在する可能性のあるキーを探す（一方向のみで管理されていると仮定せず両方探す）
        // ※今回の実装では i<j の順で保存されるが、念のため両方向チェックは安全策
        const key1 = `${player.id}-${opponent.id}`;
        const key2 = `${opponent.id}-${player.id}`;
        
        let sA: number | null = null;
        let sB: number | null = null;

        // 自分がA側(key1)の場合
        if (matches[key1]) {
          sA = matches[key1].scoreA;
          sB = matches[key1].scoreB;
        } 
        // 自分がB側(key2)の場合、スコアを読み替える
        else if (matches[key2]) {
          sA = matches[key2].scoreB; // 自分のスコア
          sB = matches[key2].scoreA; // 相手のスコア
        }

        if (sA !== null && sB !== null) {
          if (mode === "score") {
            goalsFor += sA;
            goalsAgainst += sB;
            if (sA > sB) wins++;
            else if (sA < sB) losses++;
            else draws++;
          } else {
            // 勝敗モード: 1=勝, 0=負
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

    // ソート実行
    return stats.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (mode === "score" && a.losses !== b.losses) return a.losses - b.losses;

      // 直接対決
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
  const winner = hasMatches && rankedPlayers.length > 0 ? rankedPlayers[0] : null;

  const saveImage = () => {
    if (tableRef.current === null) return;
    toPng(tableRef.current, { cacheBust: true, backgroundColor: '#ffffff' })
      .then((dataUrl) => {
        const link = document.createElement("a");
        link.download = "league-result.png";
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => console.error(err));
  };

  return (
    <div className="min-h-screen p-8 bg-gray-50 text-gray-800 font-sans">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-lg">
        <h1 className="text-2xl font-bold mb-6 text-center border-b pb-4">総当たりリーグ戦アプリ</h1>

        {phase === "settings" && (
          <div className="space-y-6">
            <div>
              <h2 className="font-bold mb-2">1. 対戦形式</h2>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer border p-4 rounded-lg has-[:checked]:bg-blue-50 has-[:checked]:border-blue-500">
                  <input type="radio" checked={mode === "score"} onChange={() => setMode("score")} />
                  <div>
                    <div className="font-bold">スコア入力式 (A案)</div>
                    <div className="text-sm text-gray-500">得点数を入力。得失点差などが順位に影響。</div>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer border p-4 rounded-lg has-[:checked]:bg-blue-50 has-[:checked]:border-blue-500">
                  <input type="radio" checked={mode === "win-loss"} onChange={() => setMode("win-loss")} />
                  <div>
                    <div className="font-bold">勝敗のみ (B案)</div>
                    <div className="text-sm text-gray-500">勝ち・負けのみ記録。シンプル。</div>
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
                <h2 className="text-center font-bold text-xl mb-4">対戦結果表</h2>
                
                <div className="overflow-x-auto mb-8">
                  <table className="w-full border-collapse border border-gray-300 text-sm md:text-base">
                    <thead>
                      <tr>
                        <th className="border p-2 bg-gray-100"></th>
                        {players.map(p => <th key={p.id} className="border p-2 bg-gray-50">{p.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {players.map((rowPlayer, i) => (
                        <tr key={rowPlayer.id}>
                          <th className="border p-2 bg-gray-50">{rowPlayer.name}</th>
                          {players.map((colPlayer, j) => {
                            // 対角線（自分自身）
                            if (i === j) return <td key={colPlayer.id} className="border p-2 bg-gray-300"></td>;
                            
                            // データの正規化: 常にindexが小さい方を p1(データ主), 大きい方を p2(データ従) とする
                            // isReversed: 今描画しているセルが「逆視点（下側）」かどうか
                            const isReversed = i > j;
                            const p1 = isReversed ? colPlayer : rowPlayer;
                            const p2 = isReversed ? rowPlayer : colPlayer;
                            
                            const key = `${p1.id}-${p2.id}`;
                            const res = matches[key] || { scoreA: null, scoreB: null };

                            // 表示用に値を整える（ReversedならAとBを入れ替える）
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
                                      // 自分が左側(myScore)を入力 -> データ上は正しい側へ送る
                                      onChange={(e) => updateMatchScore(p1.id, p2.id, true, e.target.value, isReversed)}
                                    />
                                    <span>-</span>
                                    <input 
                                      type="number" 
                                      className="w-10 border text-center p-1 rounded" 
                                      value={oppScore ?? ""} 
                                      // 相手が右側(oppScore)を入力
                                      onChange={(e) => updateMatchScore(p1.id, p2.id, false, e.target.value, isReversed)}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex justify-center gap-1">
                                    {/* 勝敗ボタン 
                                      updateMatchWinLoss(p1, p2, 自分の点, 相手の点, 反転してるか)
                                    */}
                                    <button 
                                        onClick={() => updateMatchWinLoss(p1.id, p2.id, 1, 0, isReversed)}
                                        className={`w-8 h-8 rounded-full border transition-all ${myScore === 1 
                                            ? 'bg-red-500 text-white border-red-600 scale-110 shadow-md' 
                                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                        title="勝ち"
                                    >○</button>
                                    
                                    {allowDraw && (
                                        <button 
                                            onClick={() => updateMatchWinLoss(p1.id, p2.id, 0.5, 0.5, isReversed)}
                                            className={`w-8 h-8 rounded-full border transition-all ${myScore === 0.5 
                                                ? 'bg-green-500 text-white border-green-600 scale-110 shadow-md' 
                                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                            title="引き分け"
                                        >△</button>
                                    )}

                                    <button 
                                        onClick={() => updateMatchWinLoss(p1.id, p2.id, 0, 1, isReversed)}
                                        className={`w-8 h-8 rounded-full border transition-all ${myScore === 0 
                                            ? 'bg-blue-500 text-white border-blue-600 scale-110 shadow-md' 
                                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                        title="負け"
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