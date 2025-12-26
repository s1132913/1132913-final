/* jshint loopfunc: true */
/* jshint esversion: 8 */

class NineBoardGo {
    constructor() {
        this.size = 9;
        this.board = [];
        this.currentPlayer = 1;
        this.gameHistory = [];
        this.boardHistory = [];
        this.consecutivePasses = 0;
        this.aiEnabled = true;
        this.gameOver = false;
        this.komi = 7.5; // 中國規則常見貼目，0.5防止和局
        this.atariGroups = new Set();
        this.ruleset = "Chinese Rules (Area Scoring + Superko)";

        this.initGame();
    }

    initGame() {
        // 1. 初始化空棋盤 (全為0，無預設棋子)
        this.board = Array(this.size).fill().map(() => Array(this.size).fill(0));
        
        // 修正需求 1：移除原本的中心交叉四顆棋子，現在是標準空棋盤開局。
        
        // 初始設定
        this.currentPlayer = 1; // 黑棋先
        this.gameHistory = [];
        this.boardHistory = [];
        
        // 將初始空盤面加入歷史，防止第一手就觸發全同型(雖然空盤不太可能)
        this.boardHistory.push(JSON.stringify(this.board));
        
        this.consecutivePasses = 0;
        this.gameOver = false;
        this.atariGroups.clear();
        this.lastMove = null;
        
        this.checkGlobalAtari();
        this.drawBoard();
        this.updateStatus();
        this.updateScoreDisplay(0, 0); // 初始分數為0
        
        // 重置 UI
        const passEl = document.getElementById('passCount');
        if(passEl) passEl.textContent = 0;
        
        document.getElementById('undoBtn').disabled = false;
        document.getElementById('passBtn').disabled = false;
        
        const aiBtn = document.getElementById('aiToggleBtn');
        if(aiBtn) aiBtn.textContent = this.aiEnabled ? "AI: 開" : "AI: 關";
    }

    drawBoard() {
        const boardEl = document.getElementById('board');
        boardEl.innerHTML = '';
        if (!this.gameOver) boardEl.classList.remove('game-over');

        // 九路棋盤星位座標
        const starPoints = [[2,2], [2,6], [4,4], [6,2], [6,6]];

        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = r;
                cell.dataset.col = c;

                // 繪製星位
                if (starPoints.some(p => p[0] === r && p[1] === c)) {
                    const dot = document.createElement('div');
                    dot.className = 'dot';
                    cell.appendChild(dot);
                }

                // 繪製棋子
                const stoneVal = this.board[r][c];
                if (stoneVal !== 0) {
                    const stone = document.createElement('div');
                    stone.className = 'stone';
                    cell.classList.add(stoneVal === 1 ? 'black' : 'white');
                    if (this.atariGroups.has(`${r},${c}`)) stone.classList.add('atari');
                    cell.appendChild(stone);
                }

                // 最後一手標記
                if (this.lastMove && this.lastMove.row === r && this.lastMove.col === c) {
                    cell.classList.add('last-move');
                }

                // 事件綁定
                cell.addEventListener('click', () => this.handleInput(r, c));
                cell.addEventListener('mouseenter', () => this.handleHover(cell, r, c));
                cell.addEventListener('mouseleave', () => this.clearHover(cell));
                
                boardEl.appendChild(cell);
            }
        }
        
        // 即時分數預估 (僅供參考，不影響最終判決)
        const score = this.calculateScoreAndTerritory();
        this.updateScoreDisplay(score.black, score.white);
    }

    handleInput(row, col) {
        if (this.gameOver || this.currentPlayer !== 1) return; // 只允許玩家操作黑棋
        this.attemptMove(row, col);
    }

    attemptMove(row, col) {
        if (this.gameOver || this.board[row][col] !== 0) return;

        const result = this.simulateMove(row, col, this.currentPlayer);
        if (!result.isValid) return;

        // 執行下棋
        this.executeMove(row, col, this.currentPlayer, result.captured);
        
        // 下棋後，重置虛手計數
        this.consecutivePasses = 0;
        document.getElementById('passCount').textContent = 0;

        // 換手
        this.currentPlayer = -this.currentPlayer;
        this.updateStatus();

        // AI 回合
        if (!this.gameOver && this.aiEnabled && this.currentPlayer === -1) {
            setTimeout(() => this.aiMove(), 500);
        }
    }

    simulateMove(row, col, player) {
        // 複製棋盤進行模擬
        const tempBoard = this.board.map(r => [...r]);
        tempBoard[row][col] = player;
        const opponent = -player;
        let captured = [];

        // 1. 檢查是否提吃對方
        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr, dc]) => {
            const nr = row + dr, nc = col + dc;
            if (this.isOnBoard(nr, nc) && tempBoard[nr][nc] === opponent) {
                if (!this.hasLiberties(tempBoard, nr, nc)) {
                    captured.push(...this.getGroup(tempBoard, nr, nc));
                }
            }
        });

        // 移除被提吃的子
        captured.forEach(s => tempBoard[s.r][s.c] = 0);

        // 2. 自殺規則檢查：下子後如果自己沒氣且沒吃到對方，則是自殺(禁手)
        if (!this.hasLiberties(tempBoard, row, col) && captured.length === 0) {
            return { isValid: false, reason: 'suicide' };
        }

        // 3. 全局同型(Superko)檢查
        const currentHash = JSON.stringify(tempBoard);
        if (this.boardHistory.includes(currentHash)) {
            return { isValid: false, reason: 'superko' };
        }

        return { isValid: true, captured };
    }

    executeMove(row, col, player, capturedStones) {
        // 紀錄歷史供悔棋用
        this.gameHistory.push({
            board: JSON.parse(JSON.stringify(this.board)),
            currentPlayer: this.currentPlayer,
            lastMove: this.lastMove,
            atariGroups: new Set(this.atariGroups),
            boardHistory: [...this.boardHistory]
        });

        this.board[row][col] = player;
        this.lastMove = { row, col };

        // 處理提子動畫
        if (capturedStones.length > 0) {
            setTimeout(() => {
                capturedStones.forEach(s => this.board[s.r][s.c] = 0);
                this.finishMoveProcess();
            }, 200);
        } else {
            this.finishMoveProcess();
        }
    }

    finishMoveProcess() {
        this.boardHistory.push(JSON.stringify(this.board));
        this.checkGlobalAtari();
        this.drawBoard();
    }

    undoMove() {
        if (this.gameHistory.length === 0 || this.gameOver) return;

        // 悔棋：若 AI 開啟，需退兩步回到玩家回合
        let steps = 1;
        if (this.aiEnabled && this.currentPlayer === 1 && this.gameHistory.length >= 2) {
            steps = 2;
        }

        while(steps > 0 && this.gameHistory.length > 0) {
            const prevState = this.gameHistory.pop();
            this.board = prevState.board;
            this.currentPlayer = prevState.currentPlayer;
            this.lastMove = prevState.lastMove;
            this.atariGroups = prevState.atariGroups;
            this.boardHistory = prevState.boardHistory;
            steps--;
        }
        
        this.gameOver = false;
        this.consecutivePasses = 0; // 悔棋後重置虛手狀態
        document.getElementById('passCount').textContent = 0;
        document.getElementById('board').classList.remove('game-over');
        this.drawBoard();
        this.updateStatus();
    }

    checkGlobalAtari() {
        this.atariGroups.clear();
        const visited = new Set();
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.board[r][c] !== 0 && !visited.has(`${r},${c}`)) {
                    const group = this.getGroup(this.board, r, c);
                    const liberties = this.countLiberties(this.board, group);
                    group.forEach(s => visited.add(`${s.r},${s.c}`));
                    if (liberties === 1) {
                        group.forEach(s => this.atariGroups.add(`${s.r},${s.c}`));
                    }
                }
            }
        }
    }

    pass() {
        if (this.gameOver) return;
        
        this.consecutivePasses++;
        document.getElementById('passCount').textContent = this.consecutivePasses;

        // 修正需求 2：雙方連續虛手，判定遊戲結束並計算勝負
        if (this.consecutivePasses >= 2) {
            this.endGame();
            return;
        }

        // 記錄 Pass 也是一種步數，需要存入歷史
        this.gameHistory.push({
            board: JSON.parse(JSON.stringify(this.board)),
            currentPlayer: this.currentPlayer,
            lastMove: this.lastMove, // Pass 沒有座標，保持上一步高亮
            atariGroups: new Set(this.atariGroups),
            boardHistory: [...this.boardHistory]
        });

        this.currentPlayer = -this.currentPlayer;
        this.updateStatus();
        
        if (this.aiEnabled && this.currentPlayer === -1) {
            setTimeout(() => this.aiMove(), 500);
        }
    }

    isOnBoard(r, c) { return r >= 0 && r < this.size && c >= 0 && c < this.size; }

    getGroup(board, r, c) {
        const color = board[r][c];
        const group = [];
        const visited = new Set();
        const stack = [{r, c}];
        while (stack.length) {
            const cur = stack.pop();
            const key = `${cur.r},${cur.c}`;
            if (visited.has(key)) continue;
            visited.add(key);
            group.push(cur);
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr, dc]) => {
                const nr = cur.r + dr, nc = cur.c + dc;
                if (this.isOnBoard(nr, nc) && board[nr][nc] === color) {
                    stack.push({r: nr, c: nc});
                }
            });
        }
        return group;
    }

    hasLiberties(board, r, c) {
        return this.getGroup(board, r, c).some(s =>
            [[0,1],[0,-1],[1,0],[-1,0]].some(([dr, dc]) => {
                const nr = s.r + dr, nc = s.c + dc;
                return this.isOnBoard(nr, nc) && board[nr][nc] === 0;
            })
        );
    }

    countLiberties(board, group) {
        const liberties = new Set();
        group.forEach(s => {
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr, dc]) => {
                const nr = s.r + dr, nc = s.c + dc;
                if (this.isOnBoard(nr, nc) && board[nr][nc] === 0) {
                    liberties.add(`${nr},${nc}`);
                }
            });
        });
        return liberties.size;
    }

    // --- Hover 提示優化 ---
    handleHover(cell, r, c) {
        if (this.gameOver || this.board[r][c] !== 0 || this.currentPlayer !== 1) return;

        this.clearHover(cell);
        const result = this.simulateMove(r, c, this.currentPlayer);

        if (!result.isValid) {
            cell.classList.add('forbidden');
            const mark = document.createElement('div');
            mark.className = 'forbidden-mark';
            cell.appendChild(mark);
        } else {
            const ghostClass = 'ghost-black';
            cell.classList.add(ghostClass);
            if (result.captured.length > 0) {
                const badge = document.createElement('div');
                badge.className = 'capture-badge';
                badge.textContent = result.captured.length;
                cell.appendChild(badge);
            }
        }
    }

    clearHover(cell) {
        cell.classList.remove('forbidden', 'ghost-black', 'ghost-white');
        const badge = cell.querySelector('.capture-badge');
        if (badge) badge.remove();
        const mark = cell.querySelector('.forbidden-mark');
        if (mark) mark.remove();
    }

    // --- 修正需求 2 & 3：遊戲結束與勝負判定 ---
    endGame() {
        this.gameOver = true;
        document.getElementById('board').classList.add('game-over');
        document.getElementById('undoBtn').disabled = true;
        document.getElementById('passBtn').disabled = true;

        // 計算分數 (中國規則：子 + 地)
        const score = this.calculateScoreAndTerritory();
        const finalWhite = score.white + this.komi;
        const diff = score.black - finalWhite;
        
        // 繪製地盤
        this.drawTerritory(score.territoryMap);

        let resultText = "";
        let winnerClass = "";
        if (diff > 0) {
            resultText = `🎉 黑棋勝 ${diff} 目`;
            winnerClass = "color: #2ecc71;";
        } else {
            resultText = `🎉 白棋勝 ${Math.abs(diff)} 目`;
            winnerClass = "color: #e74c3c;";
        }

        const statusEl = document.getElementById('status');
        statusEl.innerHTML = `
            <div style="text-align:center;">
                <h3>🏁 對局結束</h3>
                <p>黑棋 (子+地): ${score.black}</p>
                <p>白棋 (子+地): ${score.white} + ${this.komi} (貼目) = ${finalWhite}</p>
                <h2 style="${winnerClass}">${resultText}</h2>
                <small style="color:#aaa">註：使用中國數子法，死子應在終局前被提清</small>
            </div>
        `;
    }

    // 計算分數核心邏輯 (中國規則)
    calculateScoreAndTerritory() {
        let black = 0, white = 0, territoryMap = [];
        const visited = new Set();

        // 遍歷每一個點
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                const val = this.board[r][c];
                
                // 1. 如果是棋子，直接計分 (數子法)
                if (val === 1) {
                    black++;
                } else if (val === -1) {
                    white++;
                } 
                // 2. 如果是空地，分析其歸屬
                else if (!visited.has(`${r},${c}`)) {
                    const t = this.analyzeTerritory(r, c, visited);
                    
                    if (t.owner === 1) {
                        black += t.size;
                        t.points.forEach(p => territoryMap.push({ r: p.r, c: p.c, owner: 1 }));
                    } else if (t.owner === -1) {
                        white += t.size;
                        t.points.forEach(p => territoryMap.push({ r: p.r, c: p.c, owner: -1 }));
                    }
                    // t.owner === 0 代表公氣或未定義區域，不計分
                }
            }
        }
        return { black, white, territoryMap };
    }

    analyzeTerritory(r, c, visited) {
        const stack = [{r, c}];
        const region = [];
        const touchedColors = new Set();
        visited.add(`${r},${c}`);

        while (stack.length) {
            const cur = stack.pop();
            region.push(cur);
            
            [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr, dc]) => {
                const nr = cur.r + dr, nc = cur.c + dc;
                if (!this.isOnBoard(nr, nc)) return;
                
                const val = this.board[nr][nc];
                if (val === 0) {
                    const key = `${nr},${nc}`;
                    if (!visited.has(key)) {
                        visited.add(key);
                        stack.push({r: nr, c: nc});
                    }
                } else {
                    // 碰到棋子，記錄顏色
                    touchedColors.add(val);
                }
            });
        }

        let owner = 0;
        // 如果只碰到黑棋，則是黑地
        if (touchedColors.has(1) && !touchedColors.has(-1)) owner = 1;
        // 如果只碰到白棋，則是白地
        if (touchedColors.has(-1) && !touchedColors.has(1)) owner = -1;
        
        return { size: region.length, owner, points: region };
    }

    drawTerritory(map) {
        // 清除舊的地盤標記
        document.querySelectorAll('.territory-mark').forEach(el => el.remove());

        map.forEach(p => {
            const cell = document.querySelector(`.cell[data-row="${p.r}"][data-col="${p.c}"]`);
            if (!cell) return;
            const mark = document.createElement('div');
            mark.className = `territory-mark ${p.owner === 1 ? 'territory-black' : 'territory-white'}`;
            cell.appendChild(mark);
        });
    }

    updateStatus() {
        if (this.gameOver) return;
        const statusEl = document.getElementById('status');
        const boardEl = document.getElementById('board');
        
        boardEl.classList.remove('turn-black', 'turn-white');

        if (this.currentPlayer === 1) {
            statusEl.innerHTML = '🖤 黑棋 下子';
            boardEl.classList.add('turn-black');
        } else {
            statusEl.innerHTML = '⚪ 白棋 下子 (AI計算中...)';
            boardEl.classList.add('turn-white');
        }
    }

    updateScoreDisplay(b, w) {
        document.getElementById('blackScore').textContent = b;
        document.getElementById('whiteScore').textContent = w; // 貼目在顯示文字中固定顯示
    }

    // --- AI 部分 ---
    aiMove() {
        if (this.gameOver) return;

        let bestMove = null;
        let maxScore = -Infinity;
        
        const validMoves = [];
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.board[r][c] === 0) {
                    const sim = this.simulateMove(r, c, -1);
                    if (sim.isValid) {
                        validMoves.push({r, c, captured: sim.captured.length});
                    }
                }
            }
        }

        // 如果沒有合法步，或者所有步都極差，則虛手
        if (validMoves.length === 0) {
            this.pass();
            return;
        }

        // 啟發式評估
        for (let move of validMoves) {
            const score = this.evaluateMove(move.r, move.c, move.captured);
            // 增加少許隨機性，避免AI過於呆板
            const finalScore = score + Math.random() * 0.5;
            
            if (finalScore > maxScore) {
                maxScore = finalScore;
                bestMove = move;
            }
        }

        // 如果最高分太低(例如負分)，AI 可以選擇 Pass，但這裡讓它盡量下
        if (bestMove) {
            this.attemptMove(bestMove.r, bestMove.c);
        } else {
            this.pass();
        }
    }

    evaluateMove(r, c, capturedCount) {
        let score = 0;

        // 1. 提子權重 (非常高)
        score += capturedCount * 15;

        // 建立虛擬棋盤評估後續
        const nextBoard = this.board.map(row => [...row]);
        nextBoard[r][c] = -1;

        // 2. 救子 (如果下這步能讓自己的弱棋氣變多)
        const selfAtariBefore = this.getAtariCount(this.board, -1);
        const selfAtariAfter = this.getAtariCount(nextBoard, -1);
        if (selfAtariAfter < selfAtariBefore) score += 12;

        // 3. 叫吃對手
        const oppAtariBefore = this.getAtariCount(this.board, 1);
        const oppAtariAfter = this.getAtariCount(nextBoard, 1);
        if (oppAtariAfter > oppAtariBefore) score += 6;

        // 4. 金角銀邊草肚皮 (距離中心權重，但在九路棋盤天元重要)
        // 使用距離中心的倒數來給分：越近中心分越高
        const distFromCenter = Math.abs(r - 4) + Math.abs(c - 4);
        score += (8 - distFromCenter) * 0.5;

        // 5. 氣數安全評估
        const myGroup = this.getGroup(nextBoard, r, c);
        const liberties = this.countLiberties(nextBoard, myGroup);
        if (liberties <= 1 && capturedCount === 0) {
            score -= 20; // 避免送死 (除非能吃子)
        } else {
            score += liberties;
        }

        return score;
    }

    getAtariCount(board, player) {
        let count = 0;
        const visited = new Set();
        for(let r=0; r<9; r++){
            for(let c=0; c<9; c++){
                if(board[r][c] === player && !visited.has(`${r},${c}`)){
                    // 使用 getGroup 但要確保它內部讀取的 board 是傳入的參數
                    // 原本 getGroup 是讀取 this.board，這裡需要一個能夠讀取任意 board 的輔助函數
                    // 為了簡化，我們這裡手動實作類似 getGroup 的邏輯
                    const stack = [{r, c}];
                    const group = [];
                    while(stack.length){
                        const cur = stack.pop();
                        const key = `${cur.r},${cur.c}`;
                        if(visited.has(key)) continue;
                        visited.add(key);
                        group.push(cur);
                        
                        [[0,1],[0,-1],[1,0],[-1,0]].forEach(([dr, dc]) => {
                            const nr = cur.r+dr, nc = cur.c+dc;
                            if(this.isOnBoard(nr, nc) && board[nr][nc] === player) {
                                stack.push({r: nr, c: nc});
                            }
                        });
                    }
                    
                    const libs = this.countLiberties(board, group);
                    if(libs === 1) count++;
                }
            }
        }
        return count;
    }
}

// -------- 全域控制 --------
let game;
function newGame() { game = new NineBoardGo(); }
function toggleAI() { 
    if (game) {
        game.aiEnabled = !game.aiEnabled;
        const btn = document.getElementById('aiToggleBtn');
        btn.textContent = game.aiEnabled ? "AI: 開" : "AI: 關";
    } 
}
window.onload = newGame;