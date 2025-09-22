/**
 * EBTRACKER EMAIL ACCESS MANAGER
 * 
 * This script allows you to manage authorized email addresses for non-BDM roles.
 * Simply update the arrays below and replace the corresponding section in your HTML file.
 */

// AUTHORIZED EMAIL CONFIGURATION
// Add or remove email addresses as needed for each role

const AUTHORIZED_USERS = {
    
    // ESTIMATOR ROLE - Technical team members who can estimate project hours
    estimator: [
        "john.estimator@edanbrook.com",
        "sarah.technical@edanbrook.com", 
        "mike.estimation@edanbrook.com",
        "estimator@edanbrook.com",
        // Add more estimator emails below:
        // "newuser@company.com",
        // "another.estimator@domain.com",
    ],
    
    // COO ROLE - Operations management with pricing approval authority
    coo: [
        "coo@edanbrook.com",
        "operations.manager@edanbrook.com",
        "michael.operations@edanbrook.com",
        // Add more COO emails below:
        // "director.operations@company.com",
        // "ops.manager@domain.com",
    ],
    
    // DIRECTOR ROLE - Executive level with full system access
    director: [
        "director@edanbrook.com",
        "ceo@edanbrook.com", 
        "president@edanbrook.com",
        "admin@edanbrook.com",
        // Add more director emails below:
        // "executive@company.com",
        // "board.member@domain.com",
    ]
};

/**
 * INSTRUCTIONS FOR UPDATING ACCESS:
 * 
 * 1. Add New User:
 *    - Find the appropriate role array above
 *    - Add the email address in quotes, followed by a comma
 *    - Example: "newuser@company.com",
 * 
 * 2. Remove User:
 *    - Find the email in the appropriate role array
 *    - Delete the entire line including the comma
 * 
 * 3. Apply Changes:
 *    - Copy the entire AUTHORIZED_USERS object above
 *    - Replace the authorizedUsers variable in your main HTML file
 *    - The changes take effect immediately
 * 
 * 4. Verify Access:
 *    - Users can only register/login if their email is in the correct role array
 *    - BDM role remains open to all users (no restrictions)
 */

// FORMATTED FOR DIRECT COPY-PASTE INTO HTML FILE:
console.log(`
// Replace the authorizedUsers variable in your HTML file with this:

const authorizedUsers = ${JSON.stringify(AUTHORIZED_USERS, null, 4)};
`);

/**
 * ADMIN FUNCTIONS
 * These functions can be used in browser console for dynamic management
 */

// Function to add a user (can be called from browser console)
function addUserAccess(email, role) {
    if (!AUTHORIZED_USERS[role]) {
        console.error('❌ Invalid role. Valid roles: estimator, coo, director');
        return false;
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    
    if (AUTHORIZED_USERS[role].includes(normalizedEmail)) {
        console.log('⚠️ User already has access to this role');
        return false;
    }
    
    AUTHORIZED_USERS[role].push(normalizedEmail);
    console.log(`✅ Added ${normalizedEmail} to ${role} role`);
    console.log('Updated authorized users:', AUTHORIZED_USERS);
    return true;
}

// Function to remove a user (can be called from browser console)
function removeUserAccess(email, role) {
    if (!AUTHORIZED_USERS[role]) {
        console.error('❌ Invalid role. Valid roles: estimator, coo, director');
        return false;
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    const index = AUTHORIZED_USERS[role].indexOf(normalizedEmail);
    
    if (index === -1) {
        console.log('⚠️ User not found in this role');
        return false;
    }
    
    AUTHORIZED_USERS[role].splice(index, 1);
    console.log(`✅ Removed ${normalizedEmail} from ${role} role`);
    console.log('Updated authorized users:', AUTHORIZED_USERS);
    return true;
}

// Function to list all users for a role
function listRoleUsers(role) {
    if (!AUTHORIZED_USERS[role]) {
        console.error('❌ Invalid role. Valid roles: estimator, coo, director');
        return;
    }
    
    console.log(`📋 ${role.toUpperCase()} Role Users (${AUTHORIZED_USERS[role].length}):`);
    AUTHORIZED_USERS[role].forEach((email, index) => {
        console.log(`  ${index + 1}. ${email}`);
    });
}

// Function to show all authorized users
function showAllUsers() {
    console.log('📊 ALL AUTHORIZED USERS:');
    console.log('========================');
    
    Object.keys(AUTHORIZED_USERS).forEach(role => {
        console.log(`\n${role.toUpperCase()} (${AUTHORIZED_USERS[role].length} users):`);
        AUTHORIZED_USERS[role].forEach((email, index) => {
            console.log(`  ${index + 1}. ${email}`);
        });
    });
}

// Export functions for use
if (typeof window !== 'undefined') {
    // Browser environment
    window.addUserAccess = addUserAccess;
    window.removeUserAccess = removeUserAccess;
    window.listRoleUsers = listRoleUsers;
    window.showAllUsers = showAllUsers;
    window.AUTHORIZED_USERS = AUTHORIZED_USERS;
}

/**
 * QUICK REFERENCE COMMANDS:
 * 
 * In browser console, you can use these commands:
 * 
 * // Add user to a role
 * addUserAccess("newuser@company.com", "estimator")
 * 
 * // Remove user from a role  
 * removeUserAccess("olduser@company.com", "coo")
 * 
 * // List users in a specific role
 * listRoleUsers("director")
 * 
 * // Show all authorized users
 * showAllUsers()
 * 
 * // View current config
 * console.log(AUTHORIZED_USERS)
 */

/**
 * INTEGRATION STEPS:
 * 
 * 1. Update the authorized users list above
 * 2. Copy the AUTHORIZED_USERS object
 * 3. In your main HTML file, find this line:
 *    const authorizedUsers = {
 * 4. Replace the entire authorizedUsers object with your updated AUTHORIZED_USERS
 * 5. Save and deploy your HTML file
 * 
 * The authentication system will immediately use the new email list.
 */

// Generate the exact code to copy into HTML file
function generateHTMLCode() {
    return `
// COPY THIS INTO YOUR HTML FILE:
// Replace the existing authorizedUsers variable with:

const authorizedUsers = ${JSON.stringify(AUTHORIZED_USERS, null, 12)};

// THAT'S IT! Save and deploy your HTML file.
    `.trim();
}

console.log(generateHTMLCode());
