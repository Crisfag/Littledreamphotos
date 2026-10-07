// PDF minimal fait de pages-images JPEG (une image pleine page par page),
// écrit au fil de l'eau : chaque page part dès qu'elle est prête, sans
// garder tout le document en mémoire. Les JPEG sont inclus tels quels
// (filtre DCTDecode), sans recompression.

import sharp from "sharp";

export class PdfImageWriter {
  /**
   * @param {(chunk: Buffer) => void} write
   * @param {number} pageCount nombre total de pages (connu d'avance)
   * @param {{widthPt:number,heightPt:number}} pageSize en points (1/72 pouce)
   */
  constructor(write, pageCount, pageSize) {
    this.write = write;
    this.offset = 0;
    this.offsets = [];
    this.pageCount = pageCount;
    this.pageSize = pageSize;
    this.page = 0;
    this.emit(Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary"));
  }

  emit(buffer) {
    this.write(buffer);
    this.offset += buffer.length;
  }

  object(number, body) {
    this.offsets[number] = this.offset;
    const parts = Array.isArray(body) ? body : [body];
    this.emit(Buffer.from(`${number} 0 obj\n`));
    for (const part of parts) this.emit(typeof part === "string" ? Buffer.from(part, "binary") : part);
    this.emit(Buffer.from("\nendobj\n"));
  }

  // Objets : 1 catalogue, 2 arbre des pages, puis 3 par page (image,
  // contenu, page).
  async addPage(jpeg) {
    if (this.page >= this.pageCount) throw new Error("PDF : plus de pages que prévu");
    const meta = await sharp(jpeg).metadata();
    const base = 3 + this.page * 3;
    const { widthPt: w, heightPt: h } = this.pageSize;
    this.object(base, [
      `<< /Type /XObject /Subtype /Image /Width ${meta.width} /Height ${meta.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      "\nendstream",
    ]);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    this.object(base + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    this.object(base + 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${base} 0 R >> >> /Contents ${base + 1} 0 R >>`);
    this.page += 1;
  }

  end() {
    const kids = [];
    for (let i = 0; i < this.page; i++) kids.push(`${3 + i * 3 + 2} 0 R`);
    this.object(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${this.page} >>`);
    this.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    const count = 3 + this.page * 3;
    const xref = this.offset;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n++) table += `${String(this.offsets[n] || 0).padStart(10, "0")} 00000 n \n`;
    table += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.emit(Buffer.from(table));
  }
}

export const A4_LANDSCAPE_PT = { widthPt: 841.89, heightPt: 595.28 };
