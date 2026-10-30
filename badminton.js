const COURT_STATUS = {
    EMPTY: 1,       // 空場地
    ASSIGN: 2,      // 指派人員中
    IN_USE: 3       // 使用中
};
const PLAYER_STATUS = {
    REST: 1,        // 不排場
    WAIT: 2,        // 等待上場
    PLAY: 3         // 比賽中
};
const LEVEL = {
    GREEN: 1,
    YELLOW: 2,
    RED: 3,
    BLUE: 4,
}
// Google Apps Script Web App URL
var GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2Qsdc4VaSchDgmTN1tQhE7UOKt6MoH_xpiLJjlgcgfYpfB0o-gsueVDVw1MWfzRv3/exec';

function getCombinationsBy2(ary) {
    var results = [];
    for (let i = 0; i < ary.length - 1; i++) {
        for (let j = i + 1; j < ary.length; j++) {
            results.push([ary[i], ary[j]]);
        }
    }
    return results;
}
/**
 * 洗牌（F-13：改為獨立函式，不再污染 Array.prototype）
 * @param {Array} ary - 就地洗牌並回傳同一個陣列
 */
function shuffle(ary) {
    var i = ary.length;
    while (i) {
        var j = Math.floor(Math.random() * i);
        var t = ary[--i];
        ary[i] = ary[j];
        ary[j] = t;
    }
    return ary;
}
/**
 * HTML 跳脫（F-04：姓名一律經過此函式再插入 HTML / attribute）
 * @param {String} text
 * @return {String}
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const GAME = {
    /* 玩家
    [
        {
            id, name, playCount, status, level,
            friends: ['A', 'B'],   // 隊友過（依場次順序，上限見 recordMatchHistory）
            enemies: ['B', 'C'],   // 對手過
        },
    ]
    */
    playerId: 1,
    players: [],
    gameHistory: [],
    gameTimers: {}, // 儲存每個場地的計時器
    gameStartTimes: {}, // 儲存每個場地的開始時間
    /* 場地
    [
        { id, players: [], status, courtName },
    ]
    */
    courts: [],
    /**
     * 依 id 取得球員（F-16：識別鍵一律用 id）
     * @param {Number} playerId
     * @return {Object|undefined}
     */
    getPlayerById(playerId) {
        if (playerId === undefined || playerId === null) return undefined;
        return this.players.find(p => Number(p.id) === Number(playerId));
    },
    /**
     * 依玩家物件（可能來自 court.players 的反序列化副本）取得主玩家陣列中的引用
     * 優先用 id，其次用 name
     * @param {Object} playerLike
     * @return {Object|undefined}
     */
    getPlayerRef(playerLike) {
        if (!playerLike) return undefined;
        const id = playerLike.id;
        if (id !== undefined && id !== null) {
            const foundById = this.players.find(p => Number(p.id) === Number(id));
            if (foundById) return foundById;
        }
        const name = playerLike.name;
        if (name) {
            const foundByName = this.players.find(p => p.name === name);
            if (foundByName) return foundByName;
        }
        return undefined;
    },
    /**
     * 球員是否在任一場地上（含未確認的 ASSIGN 場地）
     * @param {Object} player
     * @return {Boolean}
     */
    isPlayerOnCourt(player) {
        if (!player) return false;
        return this.courts.some(c => (c.players || []).some(p =>
            p && (Number(p.id) === Number(player.id) || p.name === player.name)));
    },
    /**
     * 修復 localStorage 還原後 court.players 與 players 不是同一份引用的問題
     * - 讓場地內玩家重新指向 GAME.players 的同一個玩家物件
     * - 若找不到玩家（已被刪除），則從場地移除（F-01：不再 fallback 保留舊物件）
     */
    relinkCourtPlayers() {
        if (!Array.isArray(this.courts) || !Array.isArray(this.players)) return;
        this.courts.forEach(court => {
            if (!court) return;
            if (!Array.isArray(court.players)) court.players = [];
            court.players = court.players
                .map(p => this.getPlayerRef(p))
                .filter(Boolean);
        });
    },
    /**
     * 儲存資料到 localStorage（F-05：由散落各處的 saveData 收斂為 GAME.save）
     */
    save() {
        const dataToSave = {
            players: this.players,
            courts: this.courts,
            gameHistory: this.gameHistory,
            playerId: this.playerId,
            gameStartTimes: this.gameStartTimes || {}
        };
        try {
            localStorage.setItem("model", JSON.stringify(dataToSave));
        } catch (error) {
            console.error('儲存資料失敗:', error);
            // F-14：降級策略——先捨棄最肥且最不重要的比賽歷程再重存
            try {
                dataToSave.gameHistory = [];
                localStorage.setItem("model", JSON.stringify(dataToSave));
                alert('儲存空間不足，已捨棄比賽歷程以保留球員與場地資料');
            } catch (e) {
                console.error('儲存資料失敗（捨棄歷程後仍失敗）:', e);
                alert('資料儲存失敗，請檢查瀏覽器儲存空間');
            }
        }
    },
    /**
     * 預設場地名稱＝場地 id 數字；若該數字已被其他場地（曾被改名）占用，往後找第一個未使用的數字
     * （避免撞名，維持名稱唯一）
     * @param {Number} id
     * @return {String}
     */
    defaultCourtName(id) {
        const used = new Set(this.courts.map(c => c.courtName));
        let n = id;
        while (used.has(String(n))) n++;
        return String(n);
    },
    /**
     *  加場地
     *  @return {Court} - 加入的場地資料
     */
    addCourt() {
        // F-02：id 改用 Math.max，不再對 courts 做有副作用的 sort
        var id = this.courts.length === 0 ? 1 : Math.max(...this.courts.map(c => c.id)) + 1;
        var court = {
            id: id,
            players: [],
            status: COURT_STATUS.EMPTY,
            courtName: this.defaultCourtName(id), // 預設名稱＝id 數字，可由使用者改名
            manualIds: []   // 手動指派的 player.id（分隊時保留、不重抽）
        }
        this.courts.push(court)
        return court
    },
    /**
     *  移除空場地
     *  @return {Court} - 被移除的場地資料
     */
    removeEmptyCourt() {
        var index = this.courts.findIndex(c => c.players.length == 0)
        if (index >= 0) {
            return this.courts.splice(index, 1)[0];
        }
        return undefined;
    },
    /**
     *  遊戲結束
     *  @param {Number} id - 場地編號
     *  @return {Array} - 那一場的玩家
     */
    gameFinish(id) {
        var court = this.courts.find(c => c.id == id);
        if (court) {
            court.status = COURT_STATUS.EMPTY;
            court.manualIds = []; // 手動指派名單隨比賽結束清空
            var players = court.players.splice(0);
            // 注意：court.players 可能是反序列化後的副本，務必同步更新到主 players
            players.forEach(p => {
                const ref = this.getPlayerRef(p);
                if (ref) ref.status = PLAYER_STATUS.WAIT;
                p.status = PLAYER_STATUS.WAIT;
            });
            // 添加比賽歷程記錄
            var playerNames = players.map(p => p.name).join(', ');
            if (playerNames) {
                // 獲取比賽時間並添加到歷程中
                const gameTime = this.getGameTime(id);
                const timeString = this.formatTime(gameTime);
                const record = `${playerNames} (${timeString})`;
                this.gameHistory.push(record);
                // F-17：歷程保留最近 200 筆，避免 localStorage 無上限成長
                if (this.gameHistory.length > 200) {
                    this.gameHistory.splice(0, this.gameHistory.length - 200);
                }
                this.updateGameHistoryDisplay();
            }
            // 停止計時器
            this.stopGameTimer(id);
            this.save();
            return players;
        } else {
            console.log('court index error', id);
            return [];
        }
    },
    /**
     * 強制清除場地（用於異常狀態下無法正常「比賽結束」）
     * 目標：最終得到空場地，並把可取得的場上玩家恢復為 WAIT
     * @param {Number} courtId - 場地編號
     * @return {{success:boolean, clearedPlayers:number, message?:string}}
     */
    forceClearCourt(courtId) {
        // 先確保引用一致，避免只清到副本
        this.relinkCourtPlayers();

        const idNum = Number(courtId);
        const court = this.courts.find(c => Number(c.id) === idNum);

        // 不論場地是否存在，都嘗試停掉計時器/開始時間，避免殘留
        this.stopGameTimer(idNum);

        if (!court) {
            return { success: false, clearedPlayers: 0, message: '找不到場地' };
        }

        const playersInCourt = Array.isArray(court.players) ? court.players.slice() : [];
        playersInCourt.forEach(p => {
            const ref = this.getPlayerRef(p);
            if (ref) ref.status = PLAYER_STATUS.WAIT;
            if (p) p.status = PLAYER_STATUS.WAIT;
        });

        // 清空場地玩家 & 狀態
        court.players = [];
        court.status = COURT_STATUS.EMPTY;
        court.manualIds = [];

        return { success: true, clearedPlayers: playersInCourt.length };
    },
    /**
     * 開始比賽計時
     * @param {Number} courtId - 場地編號
     * @param {Boolean} resetTime - 是否重置開始時間（預設 false，用於恢復時保持原時間）
     */
    startGameTimer(courtId, resetTime = false) {
        if (this.gameTimers && this.gameTimers[courtId]) {
            clearInterval(this.gameTimers[courtId]);
        }
        if (!this.gameStartTimes) this.gameStartTimes = {};
        if (!this.gameTimers) this.gameTimers = {};
        // 如果是重置時間或沒有保存的開始時間，使用當前時間
        if (resetTime || !this.gameStartTimes[courtId]) {
            this.gameStartTimes[courtId] = Date.now();
        }
        this.gameTimers[courtId] = setInterval(() => {
            this.updateGameTimerDisplay(courtId);
        }, 1000);
        this.save();
    },
    /**
     * 停止比賽計時
     * @param {Number} courtId - 場地編號
     */
    stopGameTimer(courtId) {
        if (this.gameTimers && this.gameTimers[courtId]) {
            clearInterval(this.gameTimers[courtId]);
            delete this.gameTimers[courtId];
        }
        if (this.gameStartTimes && this.gameStartTimes[courtId]) {
            delete this.gameStartTimes[courtId];
        }
        // 清空計時器顯示
        this.updateGameTimerDisplay(courtId, true);
    },
    /**
     * 獲取比賽時間（毫秒）
     * @param {Number} courtId - 場地編號
     * @return {Number} - 比賽時間（毫秒）
     */
    getGameTime(courtId) {
        if (!this.gameStartTimes || !this.gameStartTimes[courtId]) return 0;
        return Date.now() - this.gameStartTimes[courtId];
    },
    /**
     * 格式化時間為 HH:MM:SS 格式
     * @param {Number} milliseconds - 毫秒數
     * @return {String} - 格式化後的時間字串
     */
    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    },
    /**
     * 更新計時器顯示
     * @param {Number} courtId - 場地編號
     * @param {Boolean} clear - 是否清空顯示
     */
    updateGameTimerDisplay(courtId, clear = false) {
        const timerElement = document.querySelector(`#court-${courtId}-timer`);
        if (timerElement) {
            if (clear) {
                timerElement.textContent = '';
            } else {
                const gameTime = this.getGameTime(courtId);
                timerElement.textContent = this.formatTime(gameTime);
            }
        }
    },
    /**
     * 更新歷史紀錄列表
     */
    updateGameHistoryDisplay() {
        $('#gameHistoryList').empty();
        this.gameHistory.forEach((record, index) => {
            $('#gameHistoryList').append(`<li><span>${index + 1}. ${escapeHtml(record)}</span></li>`);
        });
    },
    /**
     * 記錄本場的隊友/對手（於「確定」成局時呼叫一次，避免重抽過的陣容污染紀錄）
     * @param {Court} court - 已滿 4 人的場地（slot 0,1 = 隊伍一、2,3 = 隊伍二）
     */
    recordMatchHistory(court) {
        court.players.forEach((p, i, ary) => {
            var friendIndex = [1, 0, 3, 2][i];
            p.friends.push(ary[friendIndex] ? ary[friendIndex].name : "");
            var enemies = (i > 1 ? ary.slice(0, 2) : ary.slice(2, 4)).map(e => e.name);
            p.enemies.push(...enemies);
            // 防止無上限成長（每場 friends +1 / enemies +2）
            if (p.friends.length > 100) p.friends.splice(0, p.friends.length - 100);
            if (p.enemies.length > 200) p.enemies.splice(0, p.enemies.length - 200);
        });
    },
    /**
     * 某球員是否為該場地的手動指派者
     * @param {Court} court
     * @param {Number} playerId
     * @return {Boolean}
     */
    isManualPlayer(court, playerId) {
        return Array.isArray(court.manualIds) &&
            court.manualIds.some(id => Number(id) === Number(playerId));
    },
    /**
     * 手動指派球員到場地（搜尋面板點選加入）
     * @param {Number} courtId
     * @param {Number} playerId
     * @return {{success:boolean, message?:string}}
     */
    assignPlayerToCourt(courtId, playerId) {
        const court = this.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) return { success: false, message: '找不到場地' };
        if (court.status === COURT_STATUS.IN_USE) return { success: false, message: '比賽進行中，無法加入球員' };
        if (!Array.isArray(court.manualIds)) court.manualIds = [];
        if (court.players.length >= 4) return { success: false, message: '場地已滿 4 人' };
        const player = this.getPlayerById(playerId);
        if (!player) return { success: false, message: '找不到球員' };
        // 加入前 double-check 資格，防止搜尋清單過期
        if (player.status === PLAYER_STATUS.REST) return { success: false, message: `${player.name} 目前為「不排場」狀態` };
        if (player.status === PLAYER_STATUS.PLAY || this.isPlayerOnCourt(player)) return { success: false, message: `${player.name} 已在場地上` };
        court.players.push(player);
        court.manualIds.push(player.id);
        court.status = COURT_STATUS.ASSIGN;
        this.save();
        return { success: true };
    },
    /**
     * 將球員移出場地（點名移除；僅限未確認的 ASSIGN 場地）
     * @param {Number} courtId
     * @param {Number} playerId
     * @return {{success:boolean, message?:string}}
     */
    unassignPlayerFromCourt(courtId, playerId) {
        const court = this.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) return { success: false, message: '找不到場地' };
        if (court.status === COURT_STATUS.IN_USE) return { success: false, message: '比賽進行中，無法移除球員' };
        const idx = court.players.findIndex(p => Number(p.id) === Number(playerId));
        if (idx === -1) return { success: false, message: '球員不在此場地' };
        court.players.splice(idx, 1);
        court.manualIds = (court.manualIds || []).filter(id => Number(id) !== Number(playerId));
        if (court.players.length === 0) court.status = COURT_STATUS.EMPTY;
        this.save();
        return { success: true };
    },
    /**
     * 分隊：保留手動指派者，其餘空位依現行公平演算法補滿
     * 單次執行、無重試；補不滿時回報缺額並保留手動指派者
     * @param {Number} courtId
     * @return {{success:boolean, message?:string}}
     */
    assignCourt(courtId) {
        const court = this.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) return { success: false, message: '找不到場地' };
        if (court.status === COURT_STATUS.IN_USE) return { success: false, message: '已確認隊伍 無法更動' };
        this.stopGameTimer(courtId);
        this.relinkCourtPlayers();
        if (!Array.isArray(court.manualIds)) court.manualIds = [];
        // 保留手動指派者、清掉先前自動補位者；同時收斂 manualIds
        court.players = court.players.filter(p => this.isManualPlayer(court, p.id));
        court.manualIds = court.players.map(p => p.id);
        const need = 4 - court.players.length;
        if (need > 0) {
            // 全空場地沿用原完整分隊演算法（行為不變）；有手排者只做補位
            const fills = court.players.length === 0 ? this.find4Players_team() : this.findFillPlayers(need);
            if (fills.length === 0) {
                court.status = court.players.length > 0 ? COURT_STATUS.ASSIGN : COURT_STATUS.EMPTY;
                this.save();
                return {
                    success: false,
                    message: court.players.length > 0
                        ? `等待中的球員不足，還缺 ${need} 人`
                        : '等待中的球員不足 4 人，無法分隊'
                };
            }
            court.players.push(...fills);
        }
        court.status = COURT_STATUS.ASSIGN;
        console.log('court', court.id, ', players', court.players.map(p => p.name).join(', '));
        this.save();
        return { success: true };
    },
    /**
     *  下一輪的遊戲
     *  @param {Number} courtId - 指定場地 id；-1 表示補滿所有空場地
     *  @return {Boolean|Court[]} - 單場模式回傳是否成功；全場模式回傳被補上玩家的場地陣列
     */
    nextGame(courtId = -1) {
        if (courtId > -1) {
            return this.assignCourt(courtId).success;
        }
        return this.courts
            .filter(c => c.players.length == 0)
            .filter(court => this.assignCourt(court.id).success);
    },
    /**
     * 取得「目前在場上」的球員 key 集合（id 優先、name 備援）
     * @return {Set}
     */
    getInCourtKeySet() {
        const keys = new Set();
        this.courts.forEach(c => {
            (c.players || []).forEach(p => {
                if (p && p.id !== undefined && p.id !== null) keys.add(`id:${Number(p.id)}`);
                else if (p && p.name) keys.add(`name:${p.name}`);
            });
        });
        return keys;
    },
    /**
     * 補位選人：取 count 名「等待中且不在場上」的球員，場次最少優先、同場次隨機
     * 單次執行、無重試；人數不足直接回空陣列
     * @param {Number} count
     * @return {Player[]}
     */
    findFillPlayers(count) {
        this.relinkCourtPlayers();
        const inCourtKeys = this.getInCourtKeySet();
        const candidates = this.players.filter(p => {
            if (p.status !== PLAYER_STATUS.WAIT) return false;
            const key = (p.id !== undefined && p.id !== null) ? `id:${Number(p.id)}` : `name:${p.name}`;
            return !inCourtKeys.has(key);
        });
        if (candidates.length < count) return [];
        // 先洗牌再以 playCount 穩定排序：同場次者順序隨機
        shuffle(candidates);
        candidates.sort((a, b) => a.playCount - b.playCount);
        return candidates.slice(0, count);
    },
    /**
     *  找閒置的玩家, 依玩過的場次少到多排序, 同樣場次玩家會按照隊友對手次數積分來排行
     *  @return {Player[]} - 閒置的玩家（index 0,1 = 隊伍一、2,3 = 隊伍二）
     */
    find4Players_team() {
        // 保險：避免 localStorage 還原後引用不一致造成 includes() 失準
        this.relinkCourtPlayers();

        // 雖然一次只能取出四個人, 但是一開始在撈人數的時候直接看最後會需要幾個人, 讓分組時比較多人進來
        var courtCount = this.courts.filter(c => c.players.length == 0).length;

        // 以 id/name 建立「目前在場上」集合（避免引用不一致時被重複選到）
        const inCourtKeys = this.getInCourtKeySet();

        var players = this.players
            .filter(p => {
                if (p.status !== PLAYER_STATUS.WAIT) return false;
                const key = (p.id !== undefined && p.id !== null) ? `id:${Number(p.id)}` : `name:${p.name}`;
                return !inCourtKeys.has(key);
            })// 過濾掉正在遊戲中/不排場/已在場上的玩家
            .reduce((ary, p) => {
            /*
                照場次放到籃子裡面, array index x 表示玩過x 場的玩家們
                [
                    [{玩過0次},{玩過0次}],
                    ,
                    [{玩過2次}]
                    ,
                    ,
                    [{玩過5次},{玩過5次},{玩過5次},{玩過5次}],
                ]
            */
            var index = p.playCount;
            (ary[index] = ary[index] || []).push(p);
            return ary;
            }, [])
            .reduce((ary, players) => {
              // 人數不夠就把下一籃的人倒進去
              if (ary.length < courtCount * 4) {
                  ary.push(...players)
              }
              return ary;
            }, [])
        // 兩人一隊分法
        // teams = [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], ...]
        var teams = getCombinationsBy2(players);
        // 兩隊一場比賽
        // var twoTeams = [[[1, 2], [1, 3]],[[1, 2], [1, 4]],[[1, 2], [1, 5]],[[1, 2], [1, 6]], ...]
        var twoTeams = getCombinationsBy2(teams);
        var t = twoTeams.length
        // 過濾掉兩邊隊伍有重複人的狀況
        // var twoTeams = [[[1, 2], [3, 4]],[[1, 2], [3, 5]],[[1, 2], [3, 6]],[[1, 2], [3, 7]], ...];
        var twoTeams = twoTeams.filter(([team1, team2]) => team1.every(p => !team2.includes(p)))
        console.log(`${players.length}人, ${teams.length}種隊伍, ${twoTeams.length}種比賽可能(未扣除兩邊重複人數前${t})`)
        if (twoTeams.length == 0) {
            return [];
        }
        var candidates = twoTeams
            .map(twoTeam => { // twoTeam: [[player1, player2], [player3, player4]]
                return {
                    twoTeam,
                    totalPlayCount: twoTeam.flat().reduce((sum, p) => sum + p.playCount, 0),
                };
            })
            .sort((a, b) => a.totalPlayCount - b.totalPlayCount)               // 上場場次從小排到大
            .filter((obj, i, a) => obj.totalPlayCount == a[0].totalPlayCount)   // 找出上場場次最少的那一群
            .map(obj => obj.twoTeam);                                           // 只取資料
        return shuffle(candidates)[0].flat();                                   // 隨機取一組
    },
    /**
     *  加玩家
     *  @param {String} playerName - 玩家的名字
     *  @return {Player} - 加入的玩家資料
     */
    addPlayer(playerName, playerLevel) {
        if (this.players.find(p => p.name == playerName)) {
            alert('名稱重複');
            return;
        }
        var player = {
            id: this.playerId,
            name: playerName,
            playCount: 0,
            status: PLAYER_STATUS.REST,
            friends: [],
            enemies: [],
            level: playerLevel,// 1: 綠色, 2: 黃色, 3: 紅色, 4: 藍色
        }
        this.playerId++;
        this.players.push(player);
        return player;
    },
    /**
     *  移除球員（F-01/F-16：以 id 為鍵；在場上者禁止移除，避免場地殘留幽靈球員）
     *  @param {Number} playerId
     *  @return {{success:boolean, message?:string}}
     */
    removePlayerById(playerId) {
        const player = this.getPlayerById(playerId);
        if (!player) {
            return { success: false, message: '找不到球員' };
        }
        if (this.isPlayerOnCourt(player)) {
            return { success: false, message: '球員目前在場地上，請先重新分隊或清除場地再刪除' };
        }
        this.players.splice(this.players.indexOf(player), 1);
        return { success: true };
    },
    /**
     *  重置所有玩家紀錄
     */
     resetRecord() {
        this.players.forEach(player => {
            // player.playCount = 0;
            player.friends = [];
            player.enemies = [];
            player.status = PLAYER_STATUS.REST;
        });
        this.gameHistory = [];
        this.updateGameHistoryDisplay();
        // 重置所有場地狀態和計時器
        this.courts.forEach(court => {
            if (court.status === COURT_STATUS.IN_USE) {
                court.status = COURT_STATUS.EMPTY;
                this.stopGameTimer(court.id);
            }
            court.players = [];
            court.manualIds = [];
        });
    },
    /**
     *  清除所有玩家（F-06：一併清空場地，避免幽靈球員殘留）
     */
    resetPeople() {
        this.courts.forEach(court => {
            this.stopGameTimer(court.id);
            court.players = [];
            court.status = COURT_STATUS.EMPTY;
            court.manualIds = [];
        });
        this.players = [];
    },
    /**
     *  清除所有場地
     */
    resetCourt() {
        // 停止所有計時器
        this.courts.forEach(court => {
            this.stopGameTimer(court.id);
        });
        this.courts = [];
    },
    /**
     *  從 CSV 文字匯入球員
     *  @param {String} csvText - CSV 文字內容
     *  @return {Object} - 匯入結果
     */
    importPlayersFromCSV(csvText) {
        try {
            const lines = csvText.split('\n');
            const importedPlayers = [];
            let skippedCount = 0;
            // 跳過標題行，從第二行開始處理
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                // 解析 CSV 行，處理可能包含逗號的欄位
                const columns = this.parseCSVLine(line);
                if (columns.length >= 3) {
                    const name = columns[0].trim().replace(/"/g, ''); // 移除引號
                    const status = columns[2].trim().replace(/"/g, ''); // C 欄位是狀態
                    // 如果狀態不是"候補"，則匯入該球員
                    if (status !== '候補' && name) {
                        // 檢查是否已存在相同姓名的球員
                        if (!this.players.find(p => p.name === name)) {
                            const player = this.addPlayer(name, 1); // 預設為綠色等級
                            if (player) {
                                importedPlayers.push(name);
                            }
                        } else {
                            skippedCount++;
                        }
                    }
                }
            }
            return {
                success: true,
                importedCount: importedPlayers.length,
                skippedCount: skippedCount,
                importedPlayers: importedPlayers
            };
        } catch (error) {
            console.error('匯入 CSV 球員時發生錯誤:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },
    /**
     *  解析 CSV 行，處理包含逗號的欄位
     *  @param {String} line - CSV 行
     *  @return {Array} - 解析後的欄位陣列
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    },
    /**
     *  回傳資料
     */
    print() {
        console.log(JSON.stringify(this, null, 4));
    },
    /**
     *  透過 Google Apps Script 從 Google Sheet 匯入球員
     *  @param {String} sheetTabName - Google Sheet 頁籤名稱
     *  @param {String} scriptUrl - Google Apps Script Web App URL
     *  @return {Promise} - 匯入結果
     */
    async importPlayersFromSheetViaAppsScript(sheetTabName, scriptUrl) {
        try {
            const url = `${scriptUrl}?sheetTabName=${encodeURIComponent(sheetTabName)}`;
            const response = await fetch(url, {
                method: 'GET'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '未知錯誤');
            }
            // 處理匯入的資料
            const importedPlayers = [];
            let skippedCount = 0;
            for (let playerData of result.data) {
                let name = playerData.name;
                let status = playerData.status;
                if (status == '候補') {
                    continue;
                }
                // 檢查是否已存在相同姓名的球員
                if (!this.players.find(p => p.name === name)) {
                    let player = this.addPlayer(name, 1); // 預設為綠色等級
                    if (player) {
                        importedPlayers.push(name);
                    }
                } else {
                    skippedCount++;
                }
            }
            return {
                success: true,
                importedCount: importedPlayers.length,
                skippedCount: skippedCount,
                importedPlayers: importedPlayers,
                totalAvailable: result.totalCount
            };
        } catch (error) {
            console.error('透過 Apps Script 匯入球員時發生錯誤:', error);
            return {
                success: false,
                error: error.message
            };
        }
    },
};
$(document).ready(() => {
    const model = localStorage.getItem("model")
    if (model) {
        try {
            const data = JSON.parse(model);
            GAME.players = data.players || [];
            GAME.courts = data.courts || [];
            GAME.gameHistory = data.gameHistory || [];

            // 恢復 playerId，避免 ID 重複
            if (data.playerId) {
                GAME.playerId = data.playerId;
            } else if (GAME.players.length > 0) {
                // 如果沒有保存 playerId，從現有玩家中找出最大值
                GAME.playerId = Math.max(...GAME.players.map(p => p.id || 0)) + 1;
            }

            // 修復玩家狀態：確保每個玩家都有有效的狀態
            GAME.players.forEach(player => {
                if (!player.status || (player.status !== PLAYER_STATUS.REST &&
                    player.status !== PLAYER_STATUS.WAIT &&
                    player.status !== PLAYER_STATUS.PLAY)) {
                    // 如果狀態無效，預設為 REST
                    player.status = PLAYER_STATUS.REST;
                }
                // 確保其他必要屬性存在
                if (!player.friends) player.friends = [];
                if (!player.enemies) player.enemies = [];
                if (player.playCount === undefined) player.playCount = 0;
                if (!player.level) player.level = 1;
            });

            // 修復場地狀態：確保狀態與實際情況一致
            GAME.courts.forEach(court => {
                // 如果場地沒有 status 或 status 無效，根據是否有玩家來設定
                if (!court.status || (court.status !== COURT_STATUS.EMPTY &&
                    court.status !== COURT_STATUS.ASSIGN &&
                    court.status !== COURT_STATUS.IN_USE)) {
                    if (court.players && court.players.length > 0) {
                        // 有玩家但狀態不明，設為 ASSIGN（需要確認）
                        court.status = COURT_STATUS.ASSIGN;
                    } else {
                        // 沒有玩家，設為空場地
                        court.status = COURT_STATUS.EMPTY;
                    }
                }
                // 如果場地狀態是 IN_USE 但沒有玩家，設為空場地
                if (court.status === COURT_STATUS.IN_USE && (!court.players || court.players.length === 0)) {
                    court.status = COURT_STATUS.EMPTY;
                }
                // 如果場地有玩家但狀態是 EMPTY，設為 ASSIGN
                if (court.status === COURT_STATUS.EMPTY && court.players && court.players.length > 0) {
                    court.status = COURT_STATUS.ASSIGN;
                }
                // 確保 players 陣列存在
                if (!court.players) court.players = [];
            });

            // 修復反序列化後「players 與 court.players 不是同一份引用」的問題
            GAME.relinkCourtPlayers();

            // 同步場上玩家狀態，並清理「同一玩家出現在多個場地」的異常狀態
            const seenInCourts = new Set();
            GAME.courts.forEach(court => {
                if (!court || !Array.isArray(court.players)) return;

                // 去重：同一玩家不應同時存在多個場地
                court.players = court.players.filter(p => {
                    if (!p) return false;
                    const key = (p.id !== undefined && p.id !== null) ? `id:${Number(p.id)}` : `name:${p.name}`;
                    if (seenInCourts.has(key)) return false;
                    seenInCourts.add(key);
                    return true;
                });

                if (court.status === COURT_STATUS.IN_USE) {
                    // 使用中：場上玩家應為 PLAY
                    court.players.forEach(p => { p.status = PLAYER_STATUS.PLAY; });
                    // 若人數不對，視為異常：降級為 ASSIGN/EMPTY 並停表，避免「按鈕沒反應」
                    if (court.players.length !== 4) {
                        court.status = (court.players.length > 0) ? COURT_STATUS.ASSIGN : COURT_STATUS.EMPTY;
                        GAME.stopGameTimer(court.id);
                    }
                } else if (court.status === COURT_STATUS.ASSIGN) {
                    // 分隊未確認：玩家應可視為 WAIT（可再重新分隊/清除）
                    court.players.forEach(p => { p.status = PLAYER_STATUS.WAIT; });
                    if (court.players.length === 0) {
                        court.status = COURT_STATUS.EMPTY;
                    }
                } else if (court.status === COURT_STATUS.EMPTY) {
                    // 空場地不應殘留玩家
                    if (court.players.length > 0) {
                        court.players.forEach(p => { p.status = PLAYER_STATUS.WAIT; });
                        court.players = [];
                    }
                    GAME.stopGameTimer(court.id);
                }
            });

            // 手動指派名單：確保欄位存在（舊資料相容），並收斂到實際仍在場上的球員
            GAME.courts.forEach(court => {
                if (!Array.isArray(court.manualIds)) court.manualIds = [];
                court.manualIds = court.manualIds.filter(id =>
                    (court.players || []).some(p => p && Number(p.id) === Number(id)));
            });

            // 恢復計時器開始時間
            if (data.gameStartTimes) {
                GAME.gameStartTimes = data.gameStartTimes;
            }

            // 恢復進行中的比賽計時器
            GAME.courts.forEach(court => {
                if (court.status === COURT_STATUS.IN_USE) {
                    // 如果場地正在使用中，重新開始計時器
                    GAME.startGameTimer(court.id, false); // false 表示不重置時間，使用保存的時間
                }
            });

            // 修復後會在 renderCourts() 和 renderPlayers() 後保存
        } catch (error) {
            console.error('載入資料時發生錯誤:', error);
            alert('載入資料時發生錯誤，請重新整理頁面或清除資料重新開始');
        }
    }
    $('#addPlayerBtn').on('click', () => {
        $('#playerNameInput').val('');
        $('#playerLevelSelect').val('1');
        $('#addPlayerModal').show();
    });
    window.closeAddPlayerModal = function() {
        $('#addPlayerModal').hide();
    };
    // 匯入球員按鈕
    $('#importPlayersBtn').on('click', () => {
        $('#appsScriptTabInput').val('');
        $('#csvInput').val('');
        $('#importStatus').hide();
        $('#importPlayersModal').show();
    });
    window.closeImportPlayersModal = function() {
        $('#importPlayersModal').hide();
    };
    // 切換匯入方式
    $('input[name="importMethod"]').on('change', function() {
        var method = $(this).val();
        if (method === 'appsScript') {
            $('#appsScriptImportSection').show();
            $('#csvImportSection').hide();
        } else {
            $('#appsScriptImportSection').hide();
            $('#csvImportSection').show();
        }
    });
    // 確定匯入球員
    $('#confirmImportPlayersBtn').on('click', async () => {
        var importMethod = $('input[name="importMethod"]:checked').val();
        // 顯示載入狀態
        $('#importStatus').show();
        $('#importMessage').text('正在匯入球員...');
        $('#confirmImportPlayersBtn').prop('disabled', true);
        try {
            var result;
            if (importMethod === 'appsScript') {
                var sheetTabName = $('#appsScriptTabInput').val();
                if (!sheetTabName) {
                    alert('請輸入頁籤名稱');
                    $('#confirmImportPlayersBtn').prop('disabled', false);
                    return;
                }
                // 直接使用設定的 Google Apps Script URL
                result = await GAME.importPlayersFromSheetViaAppsScript(sheetTabName, GOOGLE_APPS_SCRIPT_URL);
            } else {
                var csvText = $('#csvInput').val();
                if (!csvText) {
                    alert('請輸入 CSV 資料');
                    $('#confirmImportPlayersBtn').prop('disabled', false);
                    return;
                }
                result = GAME.importPlayersFromCSV(csvText);
            }
            if (result.success) {
                var message = `匯入完成！\n成功匯入 ${result.importedCount} 名球員\n跳過 ${result.skippedCount} 名重複球員`;
                if (result.importedPlayers.length > 0) {
                    message += `\n匯入的球員：${result.importedPlayers.join(', ')}`;
                }
                if (result.totalAvailable) {
                    message += `\n總共可匯入：${result.totalAvailable} 名球員`;
                }
                $('#importMessage').text(message);
                // 更新畫面並儲存資料
                renderPlayers();
                GAME.save();
                // 3秒後關閉 modal
                setTimeout(() => {
                    closeImportPlayersModal();
                }, 3000);
            } else {
                $('#importMessage').text(`匯入失敗：${result.error}`);
            }
        } catch (error) {
            $('#importMessage').text(`匯入失敗：${error.message}`);
        } finally {
            $('#confirmImportPlayersBtn').prop('disabled', false);
        }
    });
    // 确定新增球员
    $('#confirmAddPlayerBtn').on('click', () => {
        var playerName = $('#playerNameInput').val();
        var playerLevel = $('#playerLevelSelect').val();
        if (playerName && playerLevel) {
            GAME.addPlayer(playerName, parseInt(playerLevel));
            renderPlayers();
            GAME.save();
            closeAddPlayerModal();
        } else {
            alert('請輸入球員姓名並選擇分級');
        }
    });
    // 新增場地按鈕
    $('#addCourtBtn').on('click', () => {
        GAME.addCourt();
        renderCourts();
        GAME.save();
    });
    // 刪除空場地按鈕
    $('#removeCourtBtn').on('click', () => {
        GAME.removeEmptyCourt();
        renderCourts();
        GAME.save();
    });
    // 重置所有玩家紀錄按鈕
    $('#resetRecordBtn').on('click', () => {
        GAME.resetRecord();
        renderPlayers();
        renderCourts();
        GAME.save();
    });
    // 清除所有玩家按鈕
    $('#resetPeopleBtn').on('click', () => {
        GAME.resetPeople();
        renderPlayers();
        renderCourts();
        GAME.save();
    });
    // 清除所有場地按鈕
    $('#resetCourtBtn').on('click', () => {
        GAME.resetCourt();
        renderCourts();
        GAME.save();
    });
    // 排序球員：依顏色等級 LEVEL 由大到小（藍->紅->黃->綠）
    $('#sortPlayersBtn').on('click', () => {
        GAME.players.sort((a, b) => {
            const levelA = Number(a.level || LEVEL.GREEN);
            const levelB = Number(b.level || LEVEL.GREEN);
            if (levelB !== levelA) return levelB - levelA; // LEVEL DESC
            // 同色時，讓排序穩定可預期（依 id 由小到大）
            return Number(a.id || 0) - Number(b.id || 0);
        });
        renderPlayers();
        GAME.save();
    });
    // 增加上場次數
    $(document).on('click', '.incrementBtn', function() {
        const player = GAME.getPlayerById($(this).data('player-id'));
        if (player) {
            player.playCount++;
            // 依 DOM 結構調整：避免樣式調整後 siblings('span') 失效
            $(this).closest('li').find('.playCount').first().text(player.playCount);
            GAME.save();
        }
    });
    // 減少上場次數
    $(document).on('click', '.decrementBtn', function() {
        const player = GAME.getPlayerById($(this).data('player-id'));
        if (player && player.playCount > 0) {
            player.playCount--;
            $(this).closest('li').find('.playCount').first().text(player.playCount);
            GAME.save();
        }
    });
    // 繪製球員（F-04：姓名經 escapeHtml；F-16：按鈕改用 data-player-id）
    function renderPlayers() {
        $('#playersList').empty();
        GAME.players.forEach((player, index) => {
            const safeName = escapeHtml(player.name);
            const $playerItem = $(`
                <li class="player-background-${player.level}">
                    <div class="player-row">
                        <div class="player-main">
                            <span class="player-number">${index + 1}.</span>
                            <button class="decrementBtn" data-player-id="${player.id}" aria-label="減少上場次數">-</button>
                            <span class="player-name">
                                ${safeName}
                                <span class="player-meta">(上場次數: <a class="playCount">${player.playCount}</a>)</span>
                            </span>
                            <button class="incrementBtn" data-player-id="${player.id}" aria-label="增加上場次數">+</button>
                        </div>
                        <div class="player-actions">
                            <button class="restBtn ${player.status == PLAYER_STATUS.REST ? 'resting' : ''}" data-player-id="${player.id}">
                                ${player.status == PLAYER_STATUS.REST ? '不排場' : '休息'}
                            </button>
                            <button class="colorBtn" data-player-id="${player.id}" data-current-level="${player.level}" aria-label="切換分級顏色">
                                <span class="color-indicator color-${player.level}">●</span>
                            </button>
                            <button class="deleteBtn" data-player-id="${player.id}">刪除</button>
                            <button class="cleanBtn" data-player-id="${player.id}">重置狀態</button>
                        </div>
                    </div>
                </li>
            `);
            $('#playersList').append($playerItem);
        });
    }
    // 繪製場地
    function renderCourts() {
        // 確保場上玩家引用一致，避免狀態更新只改到副本
        GAME.relinkCourtPlayers();

        $('#courtsList').empty();
        // F-02：排序用複本，不改動 GAME.courts 本身的順序
        const sortedCourts = [...GAME.courts].sort((a, b) => a.courtName.localeCompare(b.courtName));
        sortedCourts.forEach((court) => {
        // 顏色 class：court-A ~ court-E 僅在名稱恰為單一字母 A–E 時使用，其餘（含自訂名稱）用 court-random
        const courtClass = /^[A-E]$/.test(court.courtName) ? 'court-' + court.courtName : 'court-random';
        // 判斷場地是否未確認（有玩家但狀態為 ASSIGN）
        const isUnconfirmed = court.players.length > 0 && court.status === COURT_STATUS.ASSIGN;
        const courtUnconfirmedClass = isUnconfirmed ? 'unconfirmed' : '';
        const gridUnconfirmedClass = isUnconfirmed ? 'unconfirmed' : '';
        // 判斷確認按鈕是否已確認
        const assuranceBtnClass = court.status === COURT_STATUS.IN_USE ? 'confirmed' : '';
        // 4 個 slot：有人畫球員（ASSIGN 狀態可點名移除、手排者加 📌）、沒人畫可點擊的空位「＋」
        const slotsHtml = [0, 1, 2, 3].map(i => {
            const p = court.players[i];
            if (p) {
                const manualMark = GAME.isManualPlayer(court, p.id) ? '<span class="manual-mark" title="手動指派">📌</span>' : '';
                const removable = court.status === COURT_STATUS.ASSIGN ? 'removable' : '';
                const removeTitle = removable ? 'title="點擊移出場地"' : '';
                return `<div class="player player${i + 1} player-background-${p.level} courtPlayer ${removable}" data-court-id="${court.id}" data-player-id="${p.id}" ${removeTitle}>${manualMark}${escapeHtml(p.name)}</div>`;
            }
            const clickable = court.status !== COURT_STATUS.IN_USE ? 'emptySlot' : '';
            return `<div class="player player${i + 1} slot-empty ${clickable}" data-court-id="${court.id}" title="加入球員">＋</div>`;
        }).join('');
        const courtElement = $(`
                <li class="${courtClass}">
                    <div class="court-header">
                        <p>${escapeHtml(court.courtName)} <a href="#" class="renameCourtBtn" data-court-id="${court.id}" title="改場地名稱">✏️</a></p>
                        <div class="game-timer" id="court-${court.id}-timer"></div>
                    </div>
                    <div class="court-actions">
                        <a href="#" class="assignBtn" data-court-id="${court.id}">分隊</a>
                        <a href="#" class="assuranceBtn ${assuranceBtnClass}" data-court-id="${court.id}">確定</a>
                        <a href="#" class="callCourtBtn" data-court-id="${court.id}">叫場</a>
                        <a href="#" class="forceClearBtn" data-court-id="${court.id}">強制清除場地</a>
                    </div>
                    <div class="court ${courtUnconfirmedClass}">
                        <div class="court-grid ${gridUnconfirmedClass}">
                            ${slotsHtml}
                        </div>
                        <a href="#" class="finishGameBtn" data-court-id="${court.id}">比賽結束</a>
                    </div>
                </li>
            `);
            $('#courtsList').append(courtElement);
        });
    }

    // 場地按鈕事件（用事件委派，避免重繪造成偶發「沒反應」）
    $(document).off('click', '.finishGameBtn').on('click', '.finishGameBtn', function(e) {
        e.preventDefault();
        const courtId = $(this).data('court-id');
        const court = GAME.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) {
            alert('找不到場地');
            return;
        }
        if (court.status == COURT_STATUS.IN_USE) {
            if (confirm('確定要結束比賽? 請確認點擊正確')) {
                GAME.gameFinish(courtId);
                renderCourts();
                renderPlayers();
                GAME.save();
            }
        } else {
            alert('請按下確認鍵');
        }
    });

    $(document).off('click', '.assignBtn').on('click', '.assignBtn', function(e) {
        e.preventDefault();
        const courtId = $(this).data('court-id');
        // 分隊邏輯（保留手動指派者、補滿其餘空位、失敗帶原因）collapse 進 GAME.assignCourt
        const result = GAME.assignCourt(courtId);
        if (!result.success && result.message) {
            alert(result.message);
        }
        renderCourts();
        renderPlayers();
    });

    $(document).off('click', '.assuranceBtn').on('click', '.assuranceBtn', function(e) {
        e.preventDefault();
        const courtId = $(this).data('court-id');
        const court = GAME.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) {
            alert('找不到場地');
            return;
        }

        // 保險：確保引用一致再改狀態
        GAME.relinkCourtPlayers();

        if (court.status == COURT_STATUS.ASSIGN && court.players.length == 4) {
            court.status = COURT_STATUS.IN_USE; // 場地使用中
            court.players.forEach(player => {
                // player 已是 relink 後引用
                player.status = PLAYER_STATUS.PLAY;
                player.playCount++;
            });
            // 成局才記錄隊友/對手（重抽過的陣容不會污染紀錄）
            GAME.recordMatchHistory(court);
            // 開始計時（重置時間，因為這是新開始的比賽）
            GAME.startGameTimer(courtId, true);
            renderCourts();
            renderPlayers();
            GAME.save();
        } else {
            if (court.players.length < 4) {
                alert('未滿四個人，無法組成隊伍');
            } else {
                alert('已確認');
            }
        }
    });

    $(document).off('click', '.forceClearBtn').on('click', '.forceClearBtn', function(e) {
        e.preventDefault();
        const courtId = $(this).data('court-id');
        const court = GAME.courts.find(c => Number(c.id) === Number(courtId));
        const courtName = court ? court.courtName : `場地 ${courtId}`;
        if (!confirm(`確定要「強制清除場地」？\n\n${courtName}\n- 將場上玩家恢復為「等待上場」\n- 停止計時並清空場地\n\n此操作用於異常狀態修復。`)) return;

        GAME.forceClearCourt(courtId);
        renderCourts();
        renderPlayers();
        GAME.save();
    });
    $(document).on('click', '.restBtn', function () {
        const player = GAME.getPlayerById($(this).data('player-id'));
        if (!player) return;
        // 在場上（含未確認分隊）者禁止切換休息，避免場地與列表狀態脫鉤
        if (GAME.isPlayerOnCourt(player)) {
            alert('球員目前在場地上，請先從場地移除再切換休息');
            return;
        }
        if (player.status == PLAYER_STATUS.REST) {
            player.status = PLAYER_STATUS.WAIT;
        } else if (player.status == PLAYER_STATUS.WAIT) {
            player.status = PLAYER_STATUS.REST;
        } else {
            alert('比賽中無法更動狀態');
            return;
        }
        // F-07：toggleClass 第二參數必須是布林
        $(this).text(player.status === PLAYER_STATUS.REST ? '不排場' : '休息');
        $(this).toggleClass('resting', player.status === PLAYER_STATUS.REST);
        GAME.save();
    });
    $(document).on('click', '.deleteBtn', function () {
        const player = GAME.getPlayerById($(this).data('player-id'));
        if (!player) return;
        if (player.status == PLAYER_STATUS.PLAY) {
            alert('比賽進行中，目前無法刪除');
            return;
        }
        // F-01：在場上（含未確認分隊）的球員禁止刪除，避免場地殘留幽靈球員
        if (GAME.isPlayerOnCourt(player)) {
            alert('球員目前在場地上（未確認的分隊），請先重新分隊或清除場地再刪除');
            return;
        }
        if (confirm('確定要刪除' + player.name + '?')) {
            const result = GAME.removePlayerById(player.id);
            if (result.success) {
                renderPlayers();
                GAME.save();
            } else {
                alert(result.message || '刪除發生問題');
            }
        }
    });
    $(document).on('click', '.cleanBtn', function () {
        const player = GAME.getPlayerById($(this).data('player-id'));
        if (!player) return;
        // F-10：在場上的球員不可直接重置狀態，否則會與場地狀態脫鉤
        if (player.status == PLAYER_STATUS.PLAY || GAME.isPlayerOnCourt(player)) {
            alert('該球員在場地上，請改用場地的「強制清除場地」處理異常');
            return;
        }
        player.status = PLAYER_STATUS.REST;
        renderPlayers();
        GAME.save();
    });
    // 顏色按鈕點擊事件
    $(document).on('click', '.colorBtn', function () {
        const player = GAME.getPlayerById($(this).data('player-id'));
        if (player) {
            // 循環切換顏色等級：1(綠) -> 2(黃) -> 3(紅) -> 4(藍) -> 1(綠)
            player.level = player.level % 4 + 1;
            // 更新按鈕的 data 屬性
            $(this).data('current-level', player.level);
            // 重新渲染球員列表以更新顏色
            renderPlayers();
            GAME.save();
        }
    });

    // ===== 手動指派球員上場 =====
    let assignTargetCourtId = null; // 搜尋面板目前指向的場地
    window.closeAssignPlayerModal = function() {
        $('#assignPlayerModal').hide();
        assignTargetCourtId = null;
    };
    // 渲染搜尋結果：可選者可點；不可選者灰階＋原因（休息中/場上/比賽中）
    function renderAssignPlayerResults(keyword) {
        const kw = (keyword || '').trim().toLowerCase();
        const $list = $('#assignPlayerResults').empty();
        const matched = GAME.players.filter(p => !kw || p.name.toLowerCase().includes(kw));
        if (matched.length === 0) {
            $list.append('<li class="assign-empty">沒有符合的球員</li>');
            return;
        }
        matched.forEach(p => {
            let reason = '';
            if (p.status === PLAYER_STATUS.PLAY) reason = '比賽中';
            else if (GAME.isPlayerOnCourt(p)) reason = '場上';
            else if (p.status === PLAYER_STATUS.REST) reason = '休息中';
            const disabledClass = reason ? 'disabled' : '';
            $list.append(`
                <li class="assign-result ${disabledClass}" data-player-id="${p.id}">
                    <span class="color-indicator color-${p.level}">●</span>
                    <span class="assign-name">${escapeHtml(p.name)}</span>
                    <span class="assign-meta">${reason || `上場 ${p.playCount} 次`}</span>
                </li>
            `);
        });
    }
    function openAssignPlayerModal(courtId) {
        const court = GAME.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) return;
        assignTargetCourtId = Number(courtId);
        $('#assignCourtName').text(court.courtName);
        $('#assignPlayerSearchInput').val('');
        renderAssignPlayerResults('');
        $('#assignPlayerModal').show();
        $('#assignPlayerSearchInput').trigger('focus');
    }
    // 搜尋欄即時過濾
    $('#assignPlayerSearchInput').on('input', function() {
        renderAssignPlayerResults($(this).val());
    });
    // 點空位「＋」開啟搜尋面板
    $(document).on('click', '.emptySlot', function() {
        openAssignPlayerModal($(this).data('court-id'));
    });
    // 點搜尋結果將球員加入場地
    $(document).on('click', '.assign-result:not(.disabled)', function() {
        if (assignTargetCourtId === null) return;
        const result = GAME.assignPlayerToCourt(assignTargetCourtId, $(this).data('player-id'));
        if (result.success) {
            closeAssignPlayerModal();
            renderCourts();
            renderPlayers();
        } else {
            alert(result.message);
            renderAssignPlayerResults($('#assignPlayerSearchInput').val()); // 清單過期時刷新
        }
    });
    // 點場上球員名字移除（僅 ASSIGN 狀態的球員格帶 removable class）
    $(document).on('click', '.courtPlayer.removable', function() {
        const result = GAME.unassignPlayerFromCourt($(this).data('court-id'), $(this).data('player-id'));
        if (result.success) {
            renderCourts();
            renderPlayers();
        } else if (result.message) {
            alert(result.message);
        }
    });

    // ===== 改場地名稱 =====
    $(document).on('click', '.renameCourtBtn', function(e) {
        e.preventDefault();
        const courtId = $(this).data('court-id');
        const court = GAME.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) return;
        const input = prompt('請輸入新的場地名稱（最多 8 個字）', court.courtName);
        if (input === null) return; // 取消
        const name = input.trim();
        if (!name) {
            alert('名稱不可為空白');
            return;
        }
        if (name.length > 8) {
            alert('名稱最多 8 個字');
            return;
        }
        if (GAME.courts.some(c => c.id !== court.id && c.courtName === name)) {
            alert('已有同名場地');
            return;
        }
        court.courtName = name;
        renderCourts();
        GAME.save();
    });

    // 語音叫場
    $(document).off('click', '.callCourtBtn').on('click', '.callCourtBtn', function(e) {
        e.preventDefault();
        const courtId = $(this).data('court-id');
        const court = GAME.courts.find(c => Number(c.id) === Number(courtId));
        if (!court) return;

        // 取得場地名稱與場上球員名稱
        const courtName = court.courtName;
        const playerNames = court.players.map(p => p.name).join(' ');

        // 若場上沒人，可選擇不發音或提示
        if (!playerNames) {
            alert('場地上沒有球員');
            return;
        }

        // 組裝文字並呼叫瀏覽器語音 API
        const textToSpeak = `${courtName} 場地， ${playerNames}`;
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = 'zh-TW'; // 設定中文語音
        utterance.rate = 0.7;    // 稍微放慢語速，讓廣播更清楚

        // --- 變更聲音的核心代碼 ---
        const voices = window.speechSynthesis.getVoices();

        // 篩選出所有支援中文的語音包
        const zhVoices = voices.filter(v => v.lang.includes('zh'));

        window.speechSynthesis.getVoices().filter(v => v.lang.includes('zh')).forEach(v => console.log(v.name))
        if (zhVoices.length > 0) {
            // 嘗試尋找常見的男聲 (Windows: Zhiwei, Mac: Liao)
            // 如果找不到特定的，就強制選陣列裡的第二個聲音 (通常預設女聲是第一個)
            const targetVoice = zhVoices.find(v => v.name.includes('Zhiwei') || v.name.includes('Liao')) || zhVoices[1] || zhVoices[0];
            utterance.voice = targetVoice;
        }

        window.speechSynthesis.speak(utterance);
    });

    // 初始化畫面
    renderPlayers();
    renderCourts();
    GAME.updateGameHistoryDisplay();

    // 載入資料後，如果有修復任何狀態，立即保存
    if (model) {
        GAME.save();
    }
});