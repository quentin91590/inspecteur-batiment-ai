import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, ChevronLeft, ChevronRight, Calendar, Download, AlertTriangle } from 'lucide-react';

interface HistoryItem {
  imageUrl: string;
  timestamp: number;
}

interface ImageViewerProps {
  images: HistoryItem[];
  initialIndex?: number;
  onClose: () => void;
  onDelete: (index: number) => void;
  onAddPhoto?: (file: File) => Promise<void> | void; 
  title: string;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ 
  images, 
  initialIndex = 0, 
  onClose, 
  onDelete,
  title
}) => {
  // Determine start index safe-guard
  const getSafeInitialIndex = () => {
    if (images.length === 0) return 0;
    if (initialIndex === -1) return images.length - 1;
    return Math.min(Math.max(0, initialIndex), images.length - 1);
  };

  const [currentIndex, setCurrentIndex] = useState(getSafeInitialIndex);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  
  const prevCountRef = useRef(images.length);

  // Handle updates to the images array
  useEffect(() => {
    const prevLen = prevCountRef.current;
    const currLen = images.length;

    if (currLen === 0) {
      onClose();
      return;
    }

    if (currLen > prevLen) {
      setCurrentIndex(currLen - 1);
    } else if (currLen < prevLen) {
      if (currentIndex >= currLen) {
        setCurrentIndex(currLen - 1);
      }
    }
    prevCountRef.current = currLen;
  }, [images.length, onClose, currentIndex]);

  // Reset confirmation when index changes
  useEffect(() => {
    setConfirmDelete(false);
  }, [currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, images.length, onClose]);

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
        onDelete(currentIndex);
        setConfirmDelete(false);
    } else {
        setConfirmDelete(true);
        setTimeout(() => setConfirmDelete(false), 3000); // Reset after 3s
    }
  };

  const handleDownloadCurrent = () => {
    if (!images[currentIndex]) return;
    const link = document.createElement('a');
    link.href = images[currentIndex].imageUrl;
    const dateStr = new Date(images[currentIndex].timestamp).toISOString().split('T')[0];
    link.download = `${title.replace(/\s+/g, '_')}_${dateStr}_${currentIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Swipe logic
  const minSwipeDistance = 50;
  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };
  const onTouchMove = (e: React.TouchEvent) => setTouchEnd(e.targetTouches[0].clientX);
  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe) handleNext();
    if (isRightSwipe) handlePrev();
  };

  const currentImage = images[currentIndex];
  if (!currentImage) return null;

  const dateStr = new Date(currentImage.timestamp).toLocaleString();

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-[110] bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="text-white/90 pointer-events-auto">
          <h3 className="font-bold text-lg drop-shadow-md">{title}</h3>
          <p className="text-sm opacity-80 flex items-center gap-2 drop-shadow-md">
            <Calendar size={14} />
            {dateStr}
          </p>
        </div>
        
        <div className="flex items-center gap-3 pointer-events-auto">
          <button 
            onClick={(e) => { e.stopPropagation(); handleDownloadCurrent(); }}
            className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-md border border-white/10"
            title="Télécharger l'image"
          >
            <Download size={20} />
          </button>

          <button 
            onClick={handleDeleteClick}
            className={`p-3 rounded-full transition-all backdrop-blur-md border group ${
                confirmDelete 
                ? 'bg-red-600 border-red-500 text-white animate-pulse' 
                : 'bg-red-500/20 border-red-500/20 text-red-100 hover:bg-red-500/40'
            }`}
            title={confirmDelete ? "Confirmer la suppression" : "Supprimer la photo"}
          >
            {confirmDelete ? <AlertTriangle size={20} /> : <Trash2 size={20} className="group-hover:scale-110 transition-transform" />}
          </button>

          <button 
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-md border border-white/10 ml-2"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      
      {/* Main Image Area */}
      <div 
        className="relative w-full h-full flex items-center justify-center p-4 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={e => e.stopPropagation()}
      >
        <img 
          src={currentImage.imageUrl} 
          alt={`Photo ${currentIndex + 1}`} 
          className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded-sm select-none"
        />

        {/* Navigation Arrows */}
        {currentIndex > 0 && (
          <button 
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            className="absolute left-4 p-4 text-white hover:scale-110 bg-black/20 hover:bg-black/50 rounded-full transition-all backdrop-blur-sm z-20"
          >
            <ChevronLeft size={32} />
          </button>
        )}
        
        {currentIndex < images.length - 1 && (
          <button 
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            className="absolute right-4 p-4 text-white hover:scale-110 bg-black/20 hover:bg-black/50 rounded-full transition-all backdrop-blur-sm z-20"
          >
            <ChevronRight size={32} />
          </button>
        )}
      </div>

      {/* Footer / Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/60 px-4 py-2 rounded-full text-white text-sm font-mono backdrop-blur-md border border-white/10 shadow-lg pointer-events-none">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
};