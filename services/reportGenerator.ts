import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as docx from 'docx';
import { Building, InspectionItem } from '../types';

// === HELPERS ===

/**
 * Convertit une URL (http ou data:image) en Base64 pour jsPDF
 */
const getImageBase64 = async (url: string): Promise<string | null> => {
    if (!url) return null;
    // Si c'est déjà du base64
    if (url.startsWith('data:image')) {
        return url;
    }

    try {
        // Ajout explicite de mode: 'cors' pour gérer les URL Firebase
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Impossible de charger l'image pour le PDF (Check CORS)", url);
        return null;
    }
};

/**
 * Récupère les dimensions naturelles d'une image
 */
const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
        const img = new Image();
        // Important pour éviter le tainting du canvas si utilisé ailleurs, bien que pour jsPDF on utilise le fetch blob ci-dessus
        img.crossOrigin = "Anonymous"; 
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = url;
    });
};

/**
 * Convertit une URL (http ou data:image) en Uint8Array pour DOCX
 */
const getImageUint8Array = async (url: string): Promise<Uint8Array | null> => {
    if (!url) return null;

    try {
        if (url.startsWith('data:image')) {
            // Convert Base64 -> Uint8Array
            const base64 = url.split(',')[1];
            const binaryString = window.atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        } else {
            // Fetch remote URL avec CORS
            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
            const ab = await response.arrayBuffer();
            return new Uint8Array(ab);
        }
    } catch (e) {
        console.warn("Impossible de charger l'image pour le DOCX (Check CORS)", url);
        return null;
    }
};

const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString();

// === PDF GENERATOR ===

export const generatePDF = async (building: Building, items: Record<string, InspectionItem>): Promise<Blob> => {
    const doc = new jsPDF();
    const itemList = Object.values(items);
    
    // HEADER
    doc.setFillColor(30, 41, 59); // Slate 900
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text(building.name || "Rapport d'Inspection", 105, 15, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Généré le ${new Date().toLocaleDateString()}`, 105, 25, { align: 'center' });
    if (building.address) {
        doc.text(building.address, 105, 30, { align: 'center' });
    }

    let yPos = 50;

    // SUMMARY STATS
    const totalItems = itemList.length;
    const avgScore = totalItems > 0 
        ? Math.round(itemList.reduce((acc, i) => acc + (i.averageScore || 0), 0) / totalItems) 
        : 0;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text(`Nombre d'éléments inspectés : ${totalItems}`, 14, yPos);
    doc.text(`Score global du bâtiment : ${avgScore}/100`, 14, yPos + 6);
    yPos += 15;

    // ITEMS LOOP
    // Group by category for better readability
    const grouped: Record<string, InspectionItem[]> = {};
    itemList.forEach(item => {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
    });

    for (const category of Object.keys(grouped).sort()) {
        // Add Page Break if needed
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        // Category Header
        doc.setFillColor(241, 245, 249); // Slate 100
        doc.rect(14, yPos - 5, 182, 10, 'F');
        doc.setFontSize(14);
        doc.setTextColor(30, 58, 138); // Blue 900
        doc.setFont("helvetica", "bold");
        doc.text(category, 16, yPos + 1);
        yPos += 12;

        for (const item of grouped[category]) {
             if (yPos > 240) {
                doc.addPage();
                yPos = 20;
            }

            // SubCategory Title
            doc.setFontSize(12);
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "bold");
            doc.text(`${item.subCategory}`, 14, yPos);
            
            // Score Badge (Text representation)
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.setFont("helvetica", "normal");
            const scoreLabel = item.averageScore ? `Score: ${item.averageScore}%` : "Non noté";
            doc.text(scoreLabel, 180, yPos, { align: 'right' });
            
            yPos += 6;

            // Comment
            if (item.commentaire) {
                doc.setFontSize(10);
                doc.setFont("helvetica", "italic");
                const splitComment = doc.splitTextToSize(item.commentaire, 180);
                doc.text(splitComment, 14, yPos);
                yPos += (splitComment.length * 5) + 2;
            }

            // Attributes Table
            const tableBody = Object.entries(item.attributes).map(([k, v]) => [k, v]);
            if (tableBody.length > 0) {
                autoTable(doc, {
                    startY: yPos,
                    head: [['Attribut', 'Valeur']],
                    body: tableBody,
                    theme: 'grid',
                    styles: { fontSize: 8, cellPadding: 1 },
                    headStyles: { fillColor: [59, 130, 246] }, // Blue 500
                    margin: { left: 14, right: 14 },
                });
                // Update yPos after table
                yPos = (doc as any).lastAutoTable.finalY + 6;
            }

            // Images
            if (item.photos.length > 0) {
                // Check space
                if (yPos > 220) {
                    doc.addPage();
                    yPos = 20;
                }
                
                let xImg = 14;
                const maxBoxW = 50;
                const maxBoxH = 50;

                for (let i = 0; i < Math.min(item.photos.length, 4); i++) {
                    const photo = item.photos[i];
                    try {
                        const base64 = await getImageBase64(photo.imageUrl);
                        if (base64) {
                            // Get dimensions proper to aspect ratio
                            const props = doc.getImageProperties(base64);
                            const ratio = props.width / props.height;

                            // Calculate Fit within Box logic
                            let finalW = maxBoxW;
                            let finalH = maxBoxW / ratio;

                            if (finalH > maxBoxH) {
                                finalH = maxBoxH;
                                finalW = finalH * ratio;
                            }

                            doc.addImage(base64, 'JPEG', xImg, yPos, finalW, finalH);
                            xImg += finalW + 5;
                        }
                    } catch (e) {
                        console.error("Error adding image to PDF", e);
                    }
                }
                yPos += maxBoxH + 10;
            } else {
                yPos += 5;
            }

            // Separator line
            doc.setDrawColor(200, 200, 200);
            doc.line(14, yPos - 5, 196, yPos - 5);
        }
        yPos += 10;
    }

    return doc.output('blob');
};

// === DOCX GENERATOR ===

export const generateDOCX = async (building: Building, items: Record<string, InspectionItem>): Promise<Blob> => {
    const children: any[] = [];
    const itemList = Object.values(items);

    // TITLE
    children.push(
        new docx.Paragraph({
            text: building.name || "Rapport d'Inspection",
            heading: docx.HeadingLevel.TITLE,
            alignment: docx.AlignmentType.CENTER,
        }),
        new docx.Paragraph({
            text: `Généré le ${new Date().toLocaleDateString()}`,
            alignment: docx.AlignmentType.CENTER,
            spacing: { after: 400 },
        })
    );

    if (building.address) {
        children.push(new docx.Paragraph({
            text: `Adresse : ${building.address}`,
            alignment: docx.AlignmentType.CENTER,
            spacing: { after: 400 },
        }));
    }

    // CONTENT
    // Group by category
    const grouped: Record<string, InspectionItem[]> = {};
    itemList.forEach(item => {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
    });

    for (const category of Object.keys(grouped).sort()) {
        children.push(
            new docx.Paragraph({
                text: category,
                heading: docx.HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 },
                // FIX: use 'style' instead of 'value' for border
                border: { bottom: { color: "auto", space: 1, style: docx.BorderStyle.SINGLE, size: 6 } }
            })
        );

        for (const item of grouped[category]) {
            children.push(
                new docx.Paragraph({
                    text: `${item.subCategory} (Score: ${item.averageScore || 'N/A'}%)`,
                    heading: docx.HeadingLevel.HEADING_2,
                    spacing: { before: 200, after: 100 },
                })
            );

            if (item.commentaire) {
                children.push(
                    new docx.Paragraph({
                        // FIX: italics via TextRun child
                        children: [
                            new docx.TextRun({
                                text: item.commentaire,
                                italics: true
                            })
                        ],
                        style: "Intense Quote", 
                        spacing: { after: 200 },
                    })
                );
            }

            // Attributes Table
            const tableRows = [
                new docx.TableRow({
                    children: [
                        new docx.TableCell({ 
                            // FIX: bold via TextRun child
                            children: [
                                new docx.Paragraph({
                                    children: [ new docx.TextRun({ text: "Attribut", bold: true }) ]
                                })
                            ], 
                            width: { size: 50, type: docx.WidthType.PERCENTAGE }, 
                            shading: { fill: "E0E0E0" } 
                        }),
                        new docx.TableCell({ 
                            // FIX: bold via TextRun child
                            children: [
                                new docx.Paragraph({
                                    children: [ new docx.TextRun({ text: "Valeur", bold: true }) ]
                                })
                            ], 
                            width: { size: 50, type: docx.WidthType.PERCENTAGE }, 
                            shading: { fill: "E0E0E0" } 
                        }),
                    ],
                })
            ];

            Object.entries(item.attributes).forEach(([k, v]) => {
                tableRows.push(
                    new docx.TableRow({
                        children: [
                            new docx.TableCell({ children: [new docx.Paragraph(k)] }),
                            new docx.TableCell({ children: [new docx.Paragraph(v)] }),
                        ],
                    })
                );
            });

            if (tableRows.length > 1) {
                children.push(
                    new docx.Table({
                        rows: tableRows,
                        width: { size: 100, type: docx.WidthType.PERCENTAGE },
                    })
                );
            }

            // Images
            if (item.photos.length > 0) {
                // FIX: bold via TextRun child
                children.push(new docx.Paragraph({ 
                    children: [ new docx.TextRun({ text: "Photos:", bold: true }) ],
                    spacing: { before: 200, after: 100 }
                }));
                
                const imageRuns: docx.ImageRun[] = [];
                
                // Limit to first 4 photos to avoid huge files
                for (let i = 0; i < Math.min(item.photos.length, 4); i++) {
                    const url = item.photos[i].imageUrl;
                    const buffer = await getImageUint8Array(url);
                    const dims = await getImageDimensions(url);

                    if (buffer && dims.width > 0 && dims.height > 0) {
                         // Target fixed width of 150px (approx 4cm), calc height
                         const targetWidth = 150;
                         const targetHeight = (dims.height / dims.width) * targetWidth;

                        imageRuns.push(new docx.ImageRun({
                            data: buffer,
                            transformation: { width: targetWidth, height: targetHeight }
                            // (docx 8.5 : pas d'option « type », le format est détecté automatiquement)
                        }));
                    }
                }
                
                if (imageRuns.length > 0) {
                    children.push(new docx.Paragraph({ children: imageRuns }));
                }
            }
            
            // Spacer
            children.push(new docx.Paragraph({ text: "" }));
        }
    }

    const doc = new docx.Document({
        sections: [{
            properties: {},
            children: children,
        }],
    });

    return await docx.Packer.toBlob(doc);
};