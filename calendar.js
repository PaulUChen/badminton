// Google Calendar API 整合 JavaScript

class GoogleCalendarManager {
    constructor() {
        // Google OAuth 2.0 設定 - 使用Google Identity Services
        this.clientId = '265173444535-shag5h2u6frh8oqadmdsfldptl5u04jp.apps.googleusercontent.com';
        this.scopes = 'https://www.googleapis.com/auth/calendar.readonly';
        
        // 狀態管理
        this.isSignedIn = false;
        this.accessToken = null;
        this.currentDate = new Date();
        this.events = [];
        
        this.init();
    }

    async init() {
        try {
            // 載入Google Identity Services
            await this.loadGoogleAPI();
            
            // 初始化日曆
            this.initCalendar();
            
            // 設定事件監聽器
            this.setupEventListeners();
            
            // 設定預設日期
            this.setDefaultDates();
            
            // 檢查是否已經登入
            this.checkAuthStatus();
            
        } catch (error) {
            console.error('初始化失敗:', error);
            this.showAuthStatus('初始化失敗，請重新整理頁面', 'error');
        }
    }

    async loadGoogleAPI() {
        try {
            // 等待 Google Identity Services 載入完成
            await new Promise((resolve) => {
                const checkGoogle = () => {
                    if (window.google && google.accounts && google.accounts.oauth2) {
                        resolve();
                    } else {
                        setTimeout(checkGoogle, 100);
                    }
                };
                checkGoogle();
            });

            // 初始化 Google Identity Services OAuth 客戶端
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.clientId,
                scope: this.scopes,
                callback: (tokenResponse) => {
                    if (tokenResponse.error) {
                        this.handleAuthError(tokenResponse.error);
                    } else {
                        this.handleAuthSuccess(tokenResponse);
                    }
                },
            });

            console.log('Google Identity Services 初始化成功');
        } catch (error) {
            console.error('Google API 載入失敗:', error);
            throw error;
        }
    }

    async checkAuthStatus() {
        try {
            // 檢查是否已經有有效的access token
            const token = localStorage.getItem('google_access_token');
            const tokenExpiry = localStorage.getItem('google_token_expiry');
            
            if (token && tokenExpiry && new Date().getTime() < parseInt(tokenExpiry)) {
                // Token 仍然有效
                this.accessToken = token;
                this.isSignedIn = true;
                this.updateAuthUI();
                await this.loadCalendarEvents();
            } else {
                // Token 已過期或不存在
                this.clearStoredTokens();
                this.updateAuthUI();
            }
        } catch (error) {
            console.error('檢查授權狀態失敗:', error);
            this.clearStoredTokens();
            this.updateAuthUI();
        }
    }

    updateAuthUI() {
        const authButton = document.getElementById('authButton');
        const authStatus = document.getElementById('authStatus');
        
        if (this.isSignedIn) {
            authButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> 登出';
            authButton.className = 'auth-btn signed-out';
            authStatus.innerHTML = '<i class="fas fa-check-circle"></i><span>已登入，可以查看您的行事曆</span>';
            authStatus.className = 'auth-status success';
        } else {
            authButton.innerHTML = '<i class="fab fa-google"></i> 授權 Google 帳號';
            authButton.className = 'auth-btn';
            authStatus.innerHTML = '<i class="fas fa-info-circle"></i><span>請先授權您的Google帳號以查看行事曆</span>';
            authStatus.className = 'auth-status';
        }
    }

    requestAuth() {
        if (this.isSignedIn) {
            // 如果已登入，則登出
            this.signOut();
        } else {
            // 如果未登入，則請求授權
            if (this.tokenClient) {
                this.tokenClient.requestAccessToken();
            } else {
                this.showAuthStatus('Google API 尚未準備就緒，請稍候再試', 'error');
            }
        }
    }

    handleAuthSuccess(tokenResponse) {
        this.accessToken = tokenResponse.access_token;
        this.isSignedIn = true;
        
        // 儲存token到localStorage（包含過期時間）
        const expiresIn = tokenResponse.expires_in || 3600; // 預設1小時
        const expiryTime = new Date().getTime() + (expiresIn * 1000);
        localStorage.setItem('google_access_token', this.accessToken);
        localStorage.setItem('google_token_expiry', expiryTime.toString());
        
        this.updateAuthUI();
        this.showAuthStatus('授權成功！正在載入您的行事曆...', 'success');
        
        // 載入行事曆事件
        this.loadCalendarEvents();
    }

    handleAuthError(error) {
        console.error('授權錯誤:', error);
        this.isSignedIn = false;
        this.accessToken = null;
        this.updateAuthUI();
        
        let errorMessage = '授權失敗';
        if (error === 'popup_closed_by_user') {
            errorMessage = '授權視窗被關閉，請重試';
        } else if (error === 'access_denied') {
            errorMessage = '授權被拒絕，請允許存取您的行事曆';
        } else if (error === 'popup_blocked') {
            errorMessage = '彈出視窗被阻擋，請允許彈出視窗並重試';
        }
        
        this.showAuthStatus(errorMessage, 'error');
    }

    signOut() {
        this.isSignedIn = false;
        this.accessToken = null;
        this.events = [];
        this.clearStoredTokens();
        this.updateAuthUI();
        this.renderCalendar(); // 重新渲染日曆（清除事件）
        this.showAuthStatus('已登出', 'info');
    }

    clearStoredTokens() {
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_expiry');
    }

    initCalendar() {
        this.renderCalendar();
        this.updateMonthDisplay();
    }

    setupEventListeners() {
        // 月份導航按鈕
        document.getElementById('prevMonth').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            this.renderCalendar();
            this.updateMonthDisplay();
            // 如果已登入，重新載入事件以確保新月份的事件能正確顯示
            if (this.isSignedIn && this.accessToken) {
                this.loadCalendarEvents();
            }
        });

        document.getElementById('nextMonth').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            this.renderCalendar();
            this.updateMonthDisplay();
            // 如果已登入，重新載入事件以確保新月份的事件能正確顯示
            if (this.isSignedIn && this.accessToken) {
                this.loadCalendarEvents();
            }
        });

        // 授權按鈕
        document.getElementById('authButton').addEventListener('click', () => {
            this.requestAuth();
        });

        // 空閑時間查詢按鈕
        document.getElementById('findFreeTimeBtn').addEventListener('click', () => {
            this.findFreeTime();
        });

        // 日期輸入驗證
        document.getElementById('startDate').addEventListener('change', () => {
            this.validateDateInputs();
        });

        document.getElementById('endDate').addEventListener('change', () => {
            this.validateDateInputs();
        });
    }

    setDefaultDates() {
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() + 1); // 明天開始
        
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6); // 一週後結束
        
        document.getElementById('startDate').value = this.formatDateForInput(startDate);
        document.getElementById('endDate').value = this.formatDateForInput(endDate);
    }

    formatDateForInput(date) {
        return date.toISOString().split('T')[0];
    }

    validateDateInputs() {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const findBtn = document.getElementById('findFreeTimeBtn');
        
        if (startDate && endDate && startDate <= endDate) {
            findBtn.disabled = false;
        } else {
            findBtn.disabled = true;
        }
    }

    renderCalendar() {
        const calendarDays = document.getElementById('calendarDays');
        calendarDays.innerHTML = '';
        
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        // 獲取月份第一天和最後一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        // 獲取月份第一天是星期幾
        const firstDayWeekday = firstDay.getDay();
        
        // 獲取上個月的最後幾天
        const prevMonthLastDay = new Date(year, month, 0);
        const prevMonthDays = prevMonthLastDay.getDate();
        
        // 渲染上個月的日期
        for (let i = firstDayWeekday - 1; i >= 0; i--) {
            const actualDay = prevMonthDays - i;
            const dayElement = this.createDayElement(actualDay, 'other-month', 'prev');
            calendarDays.appendChild(dayElement);
        }
        
        // 渲染當前月份的日期
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const dayElement = this.createDayElement(day, 'current-month', 'current');
            
            // 檢查是否為今天
            const currentDay = new Date(year, month, day);
            if (this.isToday(currentDay)) {
                dayElement.classList.add('today');
            }
            
            // 檢查是否有事件
            if (this.hasEventsOnDate(currentDay)) {
                dayElement.classList.add('has-events');
            }
            
            calendarDays.appendChild(dayElement);
        }
        
        // 計算需要填充的下個月日期數量
        const totalCells = 42; // 6行 x 7列
        const filledCells = firstDayWeekday + lastDay.getDate();
        const remainingCells = totalCells - filledCells;
        
        // 渲染下個月的日期
        for (let day = 1; day <= remainingCells; day++) {
            const dayElement = this.createDayElement(day, 'other-month', 'next');
            calendarDays.appendChild(dayElement);
        }
    }

    createDayElement(day, monthType, monthPosition = 'current') {
        const dayElement = document.createElement('div');
        dayElement.className = `calendar-day ${monthType}`;
        
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day;
        
        dayElement.appendChild(dayNumber);
        
        // 根據月份類型和位置計算正確的日期
        let currentDay;
        if (monthType === 'current-month') {
            // 當前月份
            currentDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), day);
        } else {
            // 其他月份
            const year = this.currentDate.getFullYear();
            const month = this.currentDate.getMonth();

            if (monthPosition === 'prev') {
                // 上個月的日期
                const prevMonth = month === 0 ? 11 : month - 1;
                const prevYear = month === 0 ? year - 1 : year;
                currentDay = new Date(prevYear, prevMonth, day);
            } else if (monthPosition === 'next') {
                // 下個月的日期
                const nextMonth = month === 11 ? 0 : month + 1;
                const nextYear = month === 11 ? year + 1 : year;
                currentDay = new Date(nextYear, nextMonth, day);
            } else {
                // 預設為當前月份（不應該發生）
                currentDay = new Date(year, month, day);
            }
        }

        // 檢查是否有事件，如果有則顯示事件數量
        const dayEvents = this.events.filter(event => {
            const eventDate = new Date(event.start.dateTime || event.start.date);
            return eventDate.toDateString() === currentDay.toDateString();
        });

        if (dayEvents.length > 0) {
            const eventCount = document.createElement('div');
            eventCount.className = 'event-count';
            eventCount.textContent = `${dayEvents.length} 個事件`;
            dayElement.appendChild(eventCount);
        }

        // 為有事件的日期添加點擊事件
        if (dayEvents.length > 0) {
            dayElement.style.cursor = 'pointer';
            dayElement.addEventListener('click', () => {
                this.showDayEventsPopup(currentDay, dayEvents, dayElement);
            });
        }

        return dayElement;
    }

    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    }

    getCalendarPosition(day, monthType) {
        // 計算日期元素在日曆網格中的位置（0-41，共42個位置）
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        // 獲取月份第一天是星期幾
        const firstDay = new Date(year, month, 1);
        const firstDayWeekday = firstDay.getDay();

        if (monthType === 'current-month') {
            // 當前月份的日期位置
            return firstDayWeekday + day - 1;
        } else if (monthType === 'other-month') {
            // 其他月份的日期位置
            if (day <= 7) {
                // 上個月的日期
                return firstDayWeekday - (7 - day) - 1;
            } else {
                // 下個月的日期
                const lastDay = new Date(year, month + 1, 0);
                const lastDayWeekday = new Date(year, month + 1, lastDay.getDate()).getDay();
                return firstDayWeekday + lastDay.getDate() + (day - 1);
            }
        }
        return 0;
    }

    hasEventsOnDate(date) {
        return this.events.some(event => {
            const eventDate = new Date(event.start.dateTime || event.start.date);
            return eventDate.toDateString() === date.toDateString();
        });
    }

    updateMonthDisplay() {
        const monthNames = [
            '1月', '2月', '3月', '4月', '5月', '6月',
            '7月', '8月', '9月', '10月', '11月', '12月'
        ];
        
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        document.getElementById('currentMonth').textContent = `${year}年${monthNames[month]}`;
    }

    async loadCalendarEvents() {
        try {
            if (!this.isSignedIn || !this.accessToken) {
                throw new Error('請先登入Google帳號');
            }
            
            this.showLoading(true);
            
            // 獲取當前月份以及未來2個月的事件
            const year = this.currentDate.getFullYear();
            const month = this.currentDate.getMonth();
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 3, 0); // 擴展到未來2個月
            
            // 使用fetch API直接調用Google Calendar API
            const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?` + 
                `timeMin=${startDate.toISOString()}&` +
                `timeMax=${endDate.toISOString()}&` +
                `maxResults=2500&` +
                `showDeleted=false&` +
                `singleEvents=true&` +
                `orderBy=startTime`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`API調用失敗: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            this.events = data.items || [];
            
            // 重新渲染日曆以顯示事件
            this.renderCalendar();
            
            this.showAuthStatus('行事曆載入完成！', 'success');
            this.showLoading(false);
            
        } catch (error) {
            console.error('載入行事曆事件失敗:', error);
            this.showAuthStatus(`載入行事曆事件失敗：${error.message}`, 'error');
            this.showLoading(false);
        }
    }

    async findFreeTime() {
        try {
            this.showLoading(true);
            
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            const startTime = document.getElementById('startTime').value;
            const endTime = document.getElementById('endTime').value;
            
            if (!startDate || !endDate || !startTime || !endTime) {
                throw new Error('請填寫完整的日期和時間資訊');
            }
            
            // 載入指定日期範圍的事件
            const events = await this.loadEventsInRange(startDate, endDate);
            
            // 計算空閑時間
            const freeTimeSlots = this.calculateFreeTime(startDate, endDate, startTime, endTime, events);
            
            // 顯示結果
            this.displayFreeTimeResults(freeTimeSlots);
            
            this.showLoading(false);
            
        } catch (error) {
            console.error('查詢空閑時間失敗:', error);
            this.showOutputError(`查詢失敗：${error.message}`);
            this.showLoading(false);
        }
    }

    async loadEventsInRange(startDate, endDate) {
        if (!this.isSignedIn || !this.accessToken) {
            throw new Error('請先登入Google帳號');
        }
        
        const start = new Date(startDate + 'T00:00:00Z');
        const end = new Date(endDate + 'T23:59:59Z');
        
        // 使用fetch API直接調用Google Calendar API
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?` + 
            `timeMin=${start.toISOString()}&` +
            `timeMax=${end.toISOString()}&` +
            `maxResults=2500&` +
            `showDeleted=false&` +
            `singleEvents=true&` +
            `orderBy=startTime`, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API調用失敗: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.items || [];
    }

    calculateFreeTime(startDate, endDate, startTime, endTime, events) {
        const freeTimeSlots = [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // 解析每日工作時間
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const [endHour, endMinute] = endTime.split(':').map(Number);
        
        // 遍歷每一天
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const currentDate = new Date(date);
            const dateString = currentDate.toISOString().split('T')[0];
            
            // 獲取當天的事件
            const dayEvents = events.filter(event => {
                const eventDate = new Date(event.start.dateTime || event.start.date);
                return eventDate.toDateString() === currentDate.toDateString();
            });
            
            // 計算當天的空閑時間
            const dayFreeSlots = this.calculateDayFreeTime(
                currentDate, 
                startHour, 
                startMinute, 
                endHour, 
                endMinute, 
                dayEvents
            );
            
            if (dayFreeSlots.length > 0) {
                freeTimeSlots.push({
                    date: dateString,
                    freeSlots: dayFreeSlots
                });
            }
        }
        
        return freeTimeSlots;
    }

    calculateDayFreeTime(date, startHour, startMinute, endHour, endMinute, events) {
        const freeSlots = [];
        
        // 設定工作時間範圍
        const workStart = new Date(date);
        workStart.setHours(startHour, startMinute, 0, 0);
        
        const workEnd = new Date(date);
        workEnd.setHours(endHour, endMinute, 0, 0);
        
        // 如果沒有事件，整個工作時間都是空閑的
        if (events.length === 0) {
            freeSlots.push({
                start: this.formatTime(workStart),
                end: this.formatTime(workEnd)
            });
            return freeSlots;
        }
        
        // 排序事件
        const sortedEvents = events.sort((a, b) => {
            const timeA = new Date(a.start.dateTime || a.start.date);
            const timeB = new Date(b.start.dateTime || b.start.date);
            return timeA - timeB;
        });
        
        let currentTime = new Date(workStart);
        
        // 檢查每個事件之間的空閑時間
        for (const event of sortedEvents) {
            const eventStart = new Date(event.start.dateTime || event.start.date);
            const eventEnd = new Date(event.end.dateTime || event.end.date);
            
            // 如果事件在工作時間之前，跳過
            if (eventEnd <= workStart) continue;
            
            // 如果事件在工作時間之後，跳過
            if (eventStart >= workEnd) continue;
            
            // 如果當前時間在事件開始之前，有空閑時間
            if (currentTime < eventStart) {
                freeSlots.push({
                    start: this.formatTime(currentTime),
                    end: this.formatTime(eventStart)
                });
            }
            
            // 更新當前時間為事件結束時間
            currentTime = new Date(Math.max(currentTime, eventEnd));
        }
        
        // 檢查最後一個事件之後的空閑時間
        if (currentTime < workEnd) {
            freeSlots.push({
                start: this.formatTime(currentTime),
                end: this.formatTime(workEnd)
            });
        }
        
        return freeSlots;
    }

    formatTime(date) {
        return date.toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    displayFreeTimeResults(freeTimeSlots) {
        const outputBox = document.getElementById('outputBox');
        
        if (freeTimeSlots.length === 0) {
            outputBox.innerHTML = '<p class="placeholder-text">在指定時間範圍內沒有找到空閑時間</p>';
            return;
        }
        
        let html = '';
        
        freeTimeSlots.forEach(daySlot => {
            // 計算星期
            const date = new Date(daySlot.date);
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            const weekday = weekdays[date.getDay()];
            
            html += `
                <div class="free-time-result">
                    <h5>📅 ${daySlot.date} (${weekday})</h5>
            `;
            
            daySlot.freeSlots.forEach(slot => {
                html += `<p>🕐 ${slot.start} - ${slot.end}</p>`;
            });
            
            html += '</div>';
        });
        
        outputBox.innerHTML = html;
    }

    showOutputError(message) {
        const outputBox = document.getElementById('outputBox');
        outputBox.innerHTML = `<p style="color: #e53e3e;">❌ ${message}</p>`;
    }

    showAuthStatus(message, type = 'info') {
        const authStatus = document.getElementById('authStatus');
        authStatus.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i><span>${message}</span>`;
        authStatus.className = `auth-status ${type}`;
    }

    showDayEventsPopup(date, events, dayElement) {
        // 移除現有的泡泡框
        const existingPopup = document.querySelector('.day-events-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // 創建泡泡框
        const popup = document.createElement('div');
        popup.className = 'day-events-popup';
        
        // 設定泡泡框內容
        const dateStr = date.toLocaleDateString('zh-TW');
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[date.getDay()];
        
        let html = `<div class="popup-header">📅 ${dateStr} (${weekday})</div>`;
        html += '<div class="popup-content">';
        
        events.forEach(event => {
            let timeDisplay = '';
            
            if (event.start.dateTime) {
                // 有時間的事件
                const startTime = new Date(event.start.dateTime).toLocaleTimeString('zh-TW', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    hour12: false 
                });
                const endTime = new Date(event.end.dateTime).toLocaleTimeString('zh-TW', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    hour12: false 
                });
                timeDisplay = `🕐 ${startTime}-${endTime}`;
            } else if (event.start.date) {
                // 全天事件
                timeDisplay = '📅 全天';
            }
            
            html += `<div class="popup-event">${timeDisplay}: ${event.summary}</div>`;
        });
        
        html += '</div>';
        popup.innerHTML = html;
        
        // 計算泡泡框位置
        const rect = dayElement.getBoundingClientRect();
        const containerRect = document.querySelector('.calendar-section').getBoundingClientRect();
        
        popup.style.position = 'absolute';
        popup.style.left = `${rect.left - containerRect.left + rect.width/2}px`;
        popup.style.top = `${rect.bottom - containerRect.top + 10}px`;
        popup.style.transform = 'translateX(-50%)';
        
        // 添加到日曆區域
        document.querySelector('.calendar-section').appendChild(popup);
        
        // 點擊其他地方關閉泡泡框
        const closePopup = (e) => {
            if (!popup.contains(e.target) && !dayElement.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        };
        
        // 延遲添加事件監聽器，避免立即觸發
        setTimeout(() => {
            document.addEventListener('click', closePopup);
        }, 100);
    }

    showLoading(show) {
        const loadingModal = document.getElementById('loadingModal');
        loadingModal.style.display = show ? 'flex' : 'none';
    }
}

// 當頁面載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    // 直接初始化Google Calendar管理器
    const calendarManager = new GoogleCalendarManager();
    
    // 顯示歡迎訊息
    const outputBox = document.getElementById('outputBox');
    outputBox.innerHTML = `
        <div style="background: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 6px; padding: 15px; margin-bottom: 15px;">
            <h5 style="color: #0056b3; margin-bottom: 10px;">🎉 歡迎使用 Google Calendar 空閑時間查詢系統</h5>
            <p style="color: #0056b3; font-size: 0.9em; margin: 5px 0;">
                ✨ 點擊左側的「授權 Google 帳號」按鈕即可開始使用
            </p>
            <p style="color: #0056b3; font-size: 0.9em; margin: 5px 0;">
                📅 授權成功後，系統會自動載入您的行事曆事件
            </p>
            <p style="color: #0056b3; font-size: 0.9em; margin: 5px 0;">
                ⏰ 您可以使用右側功能來查詢指定日期範圍內的空閑時間
            </p>
        </div>
    `;
});
