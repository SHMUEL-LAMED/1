// המצב המשותף של האתר: window.state, תיקיות ברירת המחדל ומטמון הפנים
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.


window.DEFAULT_GALLERY_FOLDERS = [
    { id: 'all', name: 'כל התמונות', icon: 'grid', isDefault: true },
    { id: '1', name: 'אירועים ופעילויות', icon: 'calendar', isDefault: true },
    { id: '2', name: 'טיולים וסיורים', icon: 'compass', isDefault: true },
    { id: '3', name: 'הווי ומפגשים', icon: 'users', isDefault: true },
    { id: '4', name: 'כללי', icon: 'home', isDefault: true }
];

window.state = {
    folders: window.DEFAULT_GALLERY_FOLDERS.map(folder => ({ ...folder })), images: [], pendingImages: [], pendingUsers: [], allUsers: [], deletionRequests: [], trashItems: [], activityLogs: [], favorites: new Set(), followedFolders: new Set(), activeFolderId: 'all', searchQuery: '', gallerySort: 'newest',
    currentLightboxIndex: -1, tempSearchResults: null,
    bulkSelectionMode: false, selectedMediaIds: new Set(), activeEventFolderId: '',
    isLocked: true, isAdminLoggedIn: false, isSuperAdmin: false, isGoogleUser: false, isInitialSuperAdminAccount: false, currentUser: null,
    userProfile: null, userRole: 'guest', userApprovalStatus: 'signed_out'
};

window.descriptorCache = {};
