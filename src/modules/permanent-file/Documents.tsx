import { useState } from 'react';
import { Download, Eye, FileText, Pencil, Plus, Search } from 'lucide-react';
import type { ListData, PermanentFileData, PermanentFileRequest } from './types';
import { displayReference } from './display';
import { VERIFICATION_STATUSES, formatDisplayDate, groupCategories } from './format';
import DocumentMetadata from './DocumentMetadata';
import UploadDocumentDialog from './UploadDocumentDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, Td, Th, Tr } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SectionCard, SectionCardBody, SectionCardHeader } from '@/components/ui/section-card';

type Props = {
  clientId: string;
  data: ListData;
  engagementId?: string;
  request: (payload: PermanentFileRequest) => Promise<PermanentFileData>;
  onChanged: () => Promise<void>;
  onPreview: (versionId: string) => void;
  onDownload: (versionId: string) => void;
};

export default function Documents({ clientId, data, engagementId, request, onChanged, onPreview, onDownload }: Props) {
  const [search, setSearch] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchEngagement, setSearchEngagement] = useState('');
  const [editing, setEditing] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDocumentId, setUploadDocumentId] = useState('');

  const uniqueDocuments = data.documents.filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index);
  const rows = data.documents.filter((row) => [row.name, row.category, data.categories[row.category] ?? '', displayReference(row), row.fileName, row.keywords ?? '']
    .some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    && (!searchCategory || row.category === searchCategory)
    && (!searchYear || (row.documentYear ?? '').toLocaleLowerCase().includes(searchYear.trim().toLocaleLowerCase()))
    && (!searchStatus || row.verificationStatus === searchStatus)
    && (!searchEngagement || row.engagementIds.includes(searchEngagement)));
  const filtered = Boolean(search || searchCategory || searchYear || searchStatus || searchEngagement);

  function openUpload(documentId = '') {
    setUploadDocumentId(documentId);
    setUploadOpen(true);
  }

  const addButton = <Button type="button" onClick={() => openUpload()}><Plus aria-hidden="true" /> Add document</Button>;

  return <SectionCard>
    <SectionCardHeader title="Documents & Versions" description="All uploaded versions are retained." actions={addButton} />
    <SectionCardBody className="space-y-4">
      {data.documents.length === 0 ? <EmptyState icon={FileText} title="No documents yet"
        description="Upload entity master information, registrations and statutory records to build the permanent file."
        action={<Button type="button" variant="outline" onClick={() => openUpload()}><Plus aria-hidden="true" /> Add document</Button>} />
        : <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
            <Field label="Search">{(c) => <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input {...c} className="pl-9" placeholder="Name or category" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>}</Field>
            <Field label="Category">{(c) => <NativeSelect {...c} value={searchCategory} onChange={(e) => setSearchCategory(e.target.value)}>
              <option value="">All categories</option>
              {groupCategories(data.categories).map((group) => <optgroup key={group.label} label={group.label}>
                {group.options.map(([code, label]) => <option key={code} value={code}>{code} — {label}</option>)}
              </optgroup>)}
            </NativeSelect>}</Field>
            <Field label="Year">{(c) => <Input {...c} placeholder="All years" value={searchYear} onChange={(e) => setSearchYear(e.target.value)} />}</Field>
            <Field label="Status">{(c) => <NativeSelect {...c} value={searchStatus} onChange={(e) => setSearchStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(VERIFICATION_STATUSES).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>}</Field>
            <Field label="Engagement">{(c) => <NativeSelect {...c} value={searchEngagement} onChange={(e) => setSearchEngagement(e.target.value)}>
              <option value="">All engagements</option>
              {data.engagements.map(({ id, name, financialYear }) => <option key={id} value={id}>{name} — {financialYear}</option>)}
            </NativeSelect>}</Field>
          </div>
          {rows.length === 0
            ? <EmptyState icon={Search} title="No documents match these filters" action={<Button type="button" variant="outline" size="sm" onClick={() => {
              setSearch(''); setSearchCategory(''); setSearchYear(''); setSearchStatus(''); setSearchEngagement('');
            }}>Clear filters</Button>} />
            : <DataTable label="Documents and versions" minWidth={540}>
              <thead><tr>
                <Th className="w-12">Sl. No.</Th><Th>Document</Th><Th>Category</Th><Th>Uploaded on</Th><Th>Status</Th><Th className="text-right">Actions</Th>
              </tr></thead>
              <tbody>{rows.map((row, index) => {
                const status = VERIFICATION_STATUSES[row.verificationStatus];
                return <Tr key={row.versionId}>
                  <Td className="tabular-nums text-subtle">{index + 1}</Td>
                  <Td className="min-w-[10rem]">
                    <span className="font-medium">{row.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-subtle">{displayReference(row)}</span>
                  </Td>
                  <Td><Badge variant="neutral" title={data.categories[row.category]}>{row.category}</Badge></Td>
                  <Td className="!whitespace-nowrap tabular-nums">{formatDisplayDate(row.uploadedAt)}</Td>
                  <Td><Badge variant={status?.tone ?? 'neutral'} className="whitespace-nowrap">{status?.label ?? row.verificationStatus}</Badge></Td>
                  <Td><div className="flex items-center justify-end gap-0.5">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`View ${row.name}, ${displayReference(row)}`} title="View" onClick={() => onPreview(row.versionId)}><Eye aria-hidden="true" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Download ${row.name}, ${displayReference(row)}`} title="Download" onClick={() => onDownload(row.versionId)}><Download aria-hidden="true" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit details of ${row.name}, ${displayReference(row)}`} title="Edit details" onClick={() => setEditing(row.versionId)}><Pencil aria-hidden="true" /></Button>
                  </div></Td>
                </Tr>;
              })}</tbody>
            </DataTable>}
          {filtered && rows.length > 0 && <p className="text-xs text-subtle">Showing {rows.length} of {data.documents.length} versions</p>}
        </>}
    </SectionCardBody>

    <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} clientId={clientId} engagementId={engagementId}
      documents={uniqueDocuments} categories={data.categories} initialDocumentId={uploadDocumentId} request={request}
      onUploaded={onChanged} />
    <DocumentMetadata clientId={clientId} document={data.documents.find((row) => row.versionId === editing) ?? null}
      engagements={data.engagements} request={request}
      onSaved={async () => { setEditing(''); await onChanged(); }} onClose={() => setEditing('')}
      onUploadVersion={(documentId) => { setEditing(''); openUpload(documentId); }} />
  </SectionCard>;
}
