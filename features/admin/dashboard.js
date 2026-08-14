// נתוני לוח הניהול
// פוצל מתוך admin.js. הקוד עצמו לא שונה — רק מיקומו.


window.updateAdminOverview = function() {
    const values = {
        adminOverviewUsersCount: (window.state.pendingUsers || []).length,
        adminOverviewPendingCount: (window.state.pendingImages || []).length,
        adminOverviewImagesCount: (window.state.images || []).length,
        adminOverviewFoldersCount: (window.state.folders || []).filter(folder => folder.id !== 'all').length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
};
