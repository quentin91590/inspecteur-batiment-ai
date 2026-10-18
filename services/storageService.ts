import { storage } from '../firebaseConfig';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

/**
 * Upload a Base64 image to Firebase Storage and returns the public download URL.
 * @param userId User ID for folder isolation
 * @param buildingId Building ID for folder isolation
 * @param base64Data The full base64 string (including data:image/jpeg;base64,...)
 * @returns Promise<string> The download URL
 */
export const uploadInspectionImage = async (
  userId: string, 
  buildingId: string, 
  base64Data: string
): Promise<string> => {
  // Generate a unique filename
  const fileName = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
  const filePath = `users/${userId}/buildings/${buildingId}/${fileName}`;
  
  const storageRef = ref(storage, filePath);

  try {
    // Upload the base64 string directly
    const snapshot = await uploadString(storageRef, base64Data, 'data_url');
    
    // Get the public URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
  } catch (error) {
    console.error("Error uploading image to storage:", error);
    // On fail, re-throw so the app can decide whether to fallback to base64 or retry
    throw error;
  }
};
