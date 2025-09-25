// firebase-rest-config.js - Firebase via REST API (no dependencies)
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'eb-tracker-42881';
const API_KEY = process.env.FIREBASE_API_KEY; // Web API key from Firebase console
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Helper to make authenticated requests to Firestore
async function firestoreRequest(path, options = {}) {
  const url = `${FIRESTORE_BASE}${path}`;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  };

  const finalOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, finalOptions);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Firestore request error:', error);
    throw error;
  }
}

// Convert Firestore document format to regular object
function convertFirestoreDoc(doc) {
  if (!doc.fields) return null;
  
  const result = { id: doc.name.split('/').pop() };
  
  Object.keys(doc.fields).forEach(key => {
    const field = doc.fields[key];
    
    if (field.stringValue !== undefined) {
      result[key] = field.stringValue;
    } else if (field.integerValue !== undefined) {
      result[key] = parseInt(field.integerValue);
    } else if (field.doubleValue !== undefined) {
      result[key] = parseFloat(field.doubleValue);
    } else if (field.booleanValue !== undefined) {
      result[key] = field.booleanValue;
    } else if (field.timestampValue !== undefined) {
      result[key] = field.timestampValue;
    } else if (field.arrayValue !== undefined) {
      result[key] = field.arrayValue.values ? field.arrayValue.values.map(v => 
        v.stringValue || v.integerValue || v.doubleValue || v.booleanValue
      ) : [];
    } else if (field.mapValue !== undefined) {
      result[key] = convertFirestoreDoc({ fields: field.mapValue.fields });
    }
  });
  
  return result;
}

// Convert regular object to Firestore document format
function convertToFirestoreDoc(obj) {
  const fields = {};
  
  Object.keys(obj).forEach(key => {
    if (key === 'id') return; // Skip ID field
    
    const value = obj[key];
    
    if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    } else if (typeof value === 'number' && Number.isInteger(value)) {
      fields[key] = { integerValue: value.toString() };
    } else if (typeof value === 'number') {
      fields[key] = { doubleValue: value };
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (value instanceof Date) {
      fields[key] = { timestampValue: value.toISOString() };
    } else if (Array.isArray(value)) {
      fields[key] = {
        arrayValue: {
          values: value.map(v => {
            if (typeof v === 'string') return { stringValue: v };
            if (typeof v === 'number') return { doubleValue: v };
            return { stringValue: String(v) };
          })
        }
      };
    } else if (typeof value === 'object' && value !== null) {
      fields[key] = { mapValue: { fields: convertToFirestoreDoc(value).fields || {} } };
    }
  });
  
  return { fields };
}

// Database operations
const db = {
  async collection(collectionName) {
    return {
      async get() {
        try {
          const response = await firestoreRequest(`/${collectionName}`);
          
          if (!response.documents) {
            return { docs: [], size: 0 };
          }
          
          const docs = response.documents.map(doc => ({
            id: doc.name.split('/').pop(),
            data: () => convertFirestoreDoc(doc),
            exists: true
          }));
          
          return {
            docs,
            size: docs.length,
            forEach: (callback) => docs.forEach(callback)
          };
        } catch (error) {
          console.error('Collection get error:', error);
          return { docs: [], size: 0 };
        }
      },

      async add(data) {
        try {
          const docData = convertToFirestoreDoc({
            ...data,
            createdAt: new Date().toISOString(),
            id: undefined
          });
          
          const response = await firestoreRequest(`/${collectionName}`, {
            method: 'POST',
            body: JSON.stringify(docData)
          });
          
          return {
            id: response.name.split('/').pop()
          };
        } catch (error) {
          console.error('Collection add error:', error);
          throw error;
        }
      },

      doc(docId) {
        return {
          async get() {
            try {
              const response = await firestoreRequest(`/${collectionName}/${docId}`);
              
              return {
                id: docId,
                exists: !!response.fields,
                data: () => response.fields ? convertFirestoreDoc(response) : null
              };
            } catch (error) {
              if (error.message.includes('404')) {
                return {
                  id: docId,
                  exists: false,
                  data: () => null
                };
              }
              throw error;
            }
          },

          async set(data) {
            try {
              const docData = convertToFirestoreDoc(data);
              
              await firestoreRequest(`/${collectionName}/${docId}`, {
                method: 'PATCH',
                body: JSON.stringify(docData)
              });
              
              return { id: docId };
            } catch (error) {
              console.error('Doc set error:', error);
              throw error;
            }
          },

          async update(updates) {
            try {
              const docData = convertToFirestoreDoc(updates);
              
              await firestoreRequest(`/${collectionName}/${docId}`, {
                method: 'PATCH',
                body: JSON.stringify(docData)
              });
              
              return { id: docId };
            } catch (error) {
              console.error('Doc update error:', error);
              throw error;
            }
          }
        };
      },

      where(field, operator, value) {
        return {
          async get() {
            // For now, get all docs and filter client-side
            // In production, you'd use Firestore's structured queries
            const allDocs = await this.parent.get();
            
            const filteredDocs = allDocs.docs.filter(doc => {
              const data = doc.data();
              
              switch (operator) {
                case '==':
                  return data[field] === value;
                case '!=':
                  return data[field] !== value;
                case '>':
                  return data[field] > value;
                case '<':
                  return data[field] < value;
                case '>=':
                  return data[field] >= value;
                case '<=':
                  return data[field] <= value;
                case 'in':
                  return Array.isArray(value) && value.includes(data[field]);
                default:
                  return false;
              }
            });
            
            return {
              docs: filteredDocs,
              size: filteredDocs.length,
              forEach: (callback) => filteredDocs.forEach(callback)
            };
          },
          parent: this
        };
      },

      orderBy(field, direction = 'asc') {
        return {
          async get() {
            const allDocs = await this.parent.get();
            
            const sortedDocs = allDocs.docs.sort((a, b) => {
              const aVal = a.data()[field];
              const bVal = b.data()[field];
              
              if (direction === 'desc') {
                return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
              } else {
                return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
              }
            });
            
            return {
              docs: sortedDocs,
              size: sortedDocs.length,
              forEach: (callback) => sortedDocs.forEach(callback)
            };
          },
          parent: this
        };
      },

      limit(count) {
        return {
          async get() {
            const allDocs = await this.parent.get();
            const limitedDocs = allDocs.docs.slice(0, count);
            
            return {
              docs: limitedDocs,
              size: limitedDocs.length,
              forEach: (callback) => limitedDocs.forEach(callback)
            };
          },
          parent: this
        };
      }
    };
  }
};

// Simple auth verification using Firebase Auth REST API
async function verifyIdToken(idToken) {
  try {
    if (!API_KEY) {
      throw new Error('Firebase API key not configured');
    }
    
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    
    if (!response.ok) {
      throw new Error('Token verification failed');
    }
    
    const data = await response.json();
    
    if (!data.users || data.users.length === 0) {
      throw new Error('User not found');
    }
    
    return {
      uid: data.users[0].localId,
      email: data.users[0].email,
      email_verified: data.users[0].emailVerified
    };
  } catch (error) {
    console.error('Token verification error:', error);
    throw error;
  }
}

// Helper functions
const helpers = {
  async logActivity(activityData) {
    try {
      const docRef = await db.collection('activities').add({
        ...activityData,
        timestamp: new Date().toISOString()
      });
      return docRef.id;
    } catch (error) {
      console.error('Error logging activity:', error);
      throw error;
    }
  },

  async getUserById(uid) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        return { uid, ...userDoc.data() };
      }
      return null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }
};

module.exports = {
  db,
  verifyIdToken,
  helpers,
  isFirebaseAvailable: !!PROJECT_ID
};
