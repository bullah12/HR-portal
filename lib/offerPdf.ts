/**
 * Offer letter PDF renderer (pdfkit). Used by GET /api/offers/[id]/pdf and
 * by the e-signature integration, which sends this document to DocuSign.
 */

import PDFDocument from 'pdfkit';
import type { OfferWithRelations } from '@/lib/offers';

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function renderOfferPdf(offer: OfferWithRelations): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const candidate = offer.application.candidate;
    const job = offer.application.job;
    const candidateName = `${candidate.firstName} ${candidate.lastName}`;
    const salary = formatMoney(Number(offer.baseSalary), offer.currency);

    doc.fontSize(20).font('Helvetica-Bold').text('Acme Corp', { continued: false });
    doc.fontSize(10).font('Helvetica').fillColor('#555555').text('People & Culture — Offer of Employment');
    doc.moveDown(0.5);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#4f46e5')
      .lineWidth(2)
      .stroke();
    doc.moveDown(1.5);

    doc.fillColor('#000000').fontSize(11);
    doc.text(formatDate(offer.createdAt));
    doc.moveDown();
    doc.text(candidateName);
    if (candidate.location) doc.text(candidate.location);
    doc.text(candidate.email);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').text(`Offer of employment — ${job.title}`);
    doc.moveDown();
    doc.font('Helvetica');
    doc.text(`Dear ${candidate.firstName},`, { lineGap: 4 });
    doc.moveDown(0.5);
    doc.text(
      `We are delighted to offer you the position of ${job.title}, based in ${job.location}. ` +
        `We were impressed throughout the interview process and believe you will be a great addition to the team.`,
      { lineGap: 4 },
    );
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Terms of the offer');
    doc.moveDown(0.5);
    doc.font('Helvetica');
    const terms: Array<[string, string]> = [
      ['Position', job.title],
      ['Location', job.location],
      ['Annual base salary', salary],
      [
        'Performance bonus',
        offer.bonusPercent === null ? 'Not applicable' : `Up to ${Number(offer.bonusPercent)}% of base salary`,
      ],
      ['Start date', formatDate(offer.startDate)],
      ['Offer valid until', formatDate(offer.expiresAt)],
    ];
    for (const [label, value] of terms) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }
    doc.moveDown();

    doc.text(
      'This offer is contingent on the completion of our sequential internal approval chain and on proof of your right to work. ' +
        'All employment terms are governed by your employment contract, which will accompany the final signed offer.',
      { lineGap: 4 },
    );
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Approval status');
    doc.moveDown(0.5);
    doc.font('Helvetica');
    for (const approval of offer.approvals) {
      doc.text(
        `${approval.sequence}. ${approval.approver.name} (${approval.approver.role.replaceAll('_', ' ')}) — ${approval.decision}` +
          (approval.decidedAt ? ` on ${formatDate(approval.decidedAt)}` : ''),
      );
    }
    doc.moveDown(1.5);

    doc.text(
      'This offer will be executed electronically via DocuSign (EU datacentre). You will receive a signing request by email once all approvals are complete.',
      { lineGap: 4 },
    );
    doc.moveDown(2);

    doc.text('For Acme Corp', { continued: false });
    doc.moveDown(2);
    doc.text('_________________________');
    doc.text('People & Culture');
    doc.moveDown(2);
    doc.text(`Accepted by ${candidateName}`);
    doc.moveDown(2);
    doc.text('_________________________');
    doc.fontSize(9).fillColor('#555555');
    doc.moveDown();
    doc.text(`Offer reference: ${offer.id} · Generated ${formatDate(new Date())} · Confidential`);

    doc.end();
  });
}
