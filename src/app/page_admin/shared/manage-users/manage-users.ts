import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../auth.service';
import { Constants } from '../../../comfig/constants';
import { GetManageUsersRes, User, Role, DegreeLevel, AccountStatus } from '../../../model_admin/res/get_manage_users_res';
import type { PatchManageUsersReq } from '../../../model/req/patch_manage_users_req';
import type { PostAddStudentReq }   from '../../../model/req/post_add_student_req';
import type { PostAddAdvisorReq }          from '../../../model/req/post_add_advisor_req';
import type { PatchStudentAddAdvisorReq } from '../../../model/req/patch_student-add_advisor_req';
import type { PostAddAdminReq } from '../../../model_admin/req/post_add_admin_req';
import type { PatchAdminReq }   from '../../../model_admin/req/patch_admin_req';
import { GetAdminListRes, Admin } from '../../../model_admin/res/get_admin_list_res';
import { apiFailure, failMsg } from '../../../server-status.service';
import { AppSelect } from '../../../Components/app-select/app-select';

type TabType = 'student' | 'advisor' | 'staff' | 'admin';
type UserTab = Exclude<TabType, 'admin'>;

// role ที่ backend ใช้กรองของแต่ละแท็บ
const TAB_ROLE: Record<UserTab, Role> = {
  student: Role.Student,
  advisor: Role.Supervisor,
  staff:   Role.Staff,
};

@Component({
  selector: 'app-manage-users',
  standalone: true,
  imports: [CommonModule, FormsModule, AppSelect],
  templateUrl: './manage-users.html',
  styleUrl: './manage-users.scss',
})
export class ManageUsers implements OnInit {
  private http      = inject(HttpClient);
  private auth      = inject(AuthService);
  private constants = inject(Constants);

  get isSuperAdmin(): boolean {
    return this.auth.user?.role === 'SuperAdmin'
      || (JSON.parse(localStorage.getItem('user') ?? 'null') as any)?.role === 'SuperAdmin';
  }
  get canSeeAdminTab(): boolean { return this.isSuperAdmin; }

  isLoading  = signal(true);
  allUsers   = signal<User[]>([]);
  activeTab          = signal<TabType>('student');
  searchText         = signal('');
  statusFilter       = signal<string>('all');
  statusDropdownOpen = signal(false);

  statusLabel = computed(() => {
    const sf = this.statusFilter();
    if (sf === 'Active')    return 'Active';
    if (sf === 'Suspended') return 'ถูกล็อค';
    return 'สถานะทั้งหมด';
  });

  toggleStatusDropdown(): void { this.statusDropdownOpen.update(v => !v); }

  selectStatus(val: string): void {
    this.statusFilter.set(val);
    this.statusDropdownOpen.set(false);
    this.reloadFromFirstPage();
  }

  // ค้นหา: แท็บ admin กรองฝั่ง client (โหลดมาครบแล้ว) ส่วนแท็บอื่นให้ backend ค้น
  // รอหยุดพิมพ์ 400ms ก่อนยิง กันยิง API ทุกตัวอักษร
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearchChange(val: string): void {
    this.searchText.set(val);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reloadFromFirstPage(), 400);
  }

  private reloadFromFirstPage(): void {
    if (this.activeTab() === 'admin') return;
    this.currentPage.set(1);
    this.loadData();
  }

  currentPage = signal(1);
  totalPages  = signal(1);
  totalItems  = signal(0);
  readonly limit = 20;

  // จำนวนทั้งหมดของแต่ละ role (ตัวเลขบนแท็บ) — ไม่ขึ้นกับตัวกรองสถานะ/คำค้น
  roleCounts = signal<Record<UserTab, number>>({ student: 0, advisor: 0, staff: 0 });

  // ── Admin tab ─────────────────────────────────────────────────────
  allAdmins        = signal<Admin[]>([]);
  isLoadingAdmins  = signal(false);

  filteredAdmins = computed(() => {
    const q  = this.searchText().toLowerCase().trim();
    const sf = this.statusFilter();
    return this.allAdmins().filter(a => {
      const name = `${a.first_name} ${a.last_name}`.toLowerCase();
      const matchSearch = !q || name.includes(q)
        || a.username.toLowerCase().includes(q)
        || a.msu_mail.toLowerCase().includes(q);
      const matchStatus = sf === 'all' || a.account_status === sf;
      return matchSearch && matchStatus;
    });
  });

  // backend กรอง role/status/search + แบ่งหน้าให้แล้ว — ตรงนี้กรอง role ซ้ำอีกชั้น
  // กันรายชื่อของแท็บเก่าโผล่ชั่วขณะระหว่างรอโหลดแท็บใหม่
  filteredStudents = computed(() => this.allUsers().filter(u => u.role === Role.Student));
  filteredAdvisors = computed(() => this.allUsers().filter(u => u.role === Role.Supervisor));
  filteredStaff    = computed(() => this.allUsers().filter(u => u.role === Role.Staff));

  // แถบสรุปเหนือตาราง: จำนวนทั้งหมดของแท็บที่เปิดอยู่ (+ จำนวนที่พบเมื่อมีตัวกรอง)
  get resultSummary(): { icon: string; label: string; unit: string; total: number; found: number; filtered: boolean } | null {
    const tab = this.activeTab();
    if (tab === 'admin' ? this.isLoadingAdmins() : this.isLoading()) return null;
    const meta = {
      student: { icon: 'ti-school',      label: 'นิสิต',   unit: 'คน' },
      advisor: { icon: 'ti-user-check',  label: 'อาจารย์', unit: 'คน' },
      staff:   { icon: 'ti-user',        label: 'Staff',   unit: 'คน' },
      admin:   { icon: 'ti-shield-lock', label: 'Admin',   unit: 'คน' },
    }[tab];
    return {
      ...meta,
      total:    tab === 'admin' ? this.allAdmins().length      : this.roleCounts()[tab],
      found:    tab === 'admin' ? this.filteredAdmins().length : this.totalItems(),
      filtered: this.statusFilter() !== 'all' || !!this.searchText().trim(),
    };
  }

  ngOnInit(): void {
    window.scrollTo({ top: 0 });
    this.loadData();
    this.loadRoleCounts();
  }

  private loadSeq = 0;

  loadData(): void {
    const tab = this.activeTab();
    if (tab === 'admin') return;

    const seq = ++this.loadSeq;
    this.isLoading.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    let params = new HttpParams()
      .set('page',  String(this.currentPage()))
      .set('limit', String(this.limit))
      .set('role',  TAB_ROLE[tab]);
    const status = this.statusFilter();
    const search = this.searchText().trim();
    if (status !== 'all') params = params.set('status', status);
    if (search)           params = params.set('search', search);

    this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, { headers, params })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        // ผลของ request เก่า (เช่น พิมพ์ค้นหาต่อ/สลับแท็บไปแล้ว) มาช้ากว่า → ทิ้ง
        if (seq !== this.loadSeq) return;
        if (res?.success) {
          this.allUsers.set(res.data.users);
          this.totalPages.set(Math.max(1, res.data.pagination.totalPages));
          this.totalItems.set(res.data.pagination.total);
        }
        this.isLoading.set(false);
      });
  }

  // ยิง limit=1 ต่อ role พร้อมกัน เอาแค่ pagination.total มาเป็นตัวเลขบนแท็บ
  loadRoleCounts(): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const count = (role: Role) => this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, {
        headers,
        params: new HttpParams().set('role', role).set('page', '1').set('limit', '1'),
      })
      .pipe(catchError(() => of(null)));

    forkJoin({
      student: count(TAB_ROLE.student),
      advisor: count(TAB_ROLE.advisor),
      staff:   count(TAB_ROLE.staff),
    }).subscribe(r => this.roleCounts.set({
      student: r.student?.data.pagination.total ?? 0,
      advisor: r.advisor?.data.pagination.total ?? 0,
      staff:   r.staff?.data.pagination.total   ?? 0,
    }));
  }

  // ── รายชื่อเต็มของบาง role (ไม่แบ่งหน้า) ──
  // ใช้กับ 2 อย่างที่ต้องเห็นทุกคน ไม่ใช่แค่หน้าละ 20: datalist อาจารย์ใน modal กำหนดอาจารย์
  // และ "ดูแลนิสิต N คน" ในแท็บอาจารย์ (backend ให้ /manage/users limit ได้ถึง 1000)
  allAdvisors      = signal<User[]>([]);
  studentsForCount = signal<User[]>([]);

  private fetchAllByRole(role: Role, target: { set(v: User[]): void }): void {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetManageUsersRes>(`${this.constants.API_ENDPOINT}/manage/users`, {
        headers,
        params: new HttpParams().set('role', role).set('page', '1').set('limit', '1000'),
      })
      .pipe(catchError(() => of(null)))
      .subscribe(res => { if (res?.success) target.set(res.data.users); });
  }

  /** หลังเพิ่ม/import ผู้ใช้ — จำนวนต่อ role เปลี่ยน ต้องโหลดตัวเลขบนแท็บใหม่ด้วย */
  private refreshAll(): void {
    this.loadData();
    this.loadRoleCounts();
    if (this.allAdvisors().length)      this.fetchAllByRole(Role.Supervisor, this.allAdvisors);
    if (this.studentsForCount().length) this.fetchAllByRole(Role.Student,    this.studentsForCount);
  }

  setTab(t: TabType): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.activeTab.set(t);
    this.searchText.set('');
    this.statusFilter.set('all');
    this.statusDropdownOpen.set(false);
    this.currentPage.set(1);
    if (t === 'admin') this.loadAdmins();
    else this.loadData();
    if (t === 'advisor') this.fetchAllByRole(Role.Student, this.studentsForCount);
  }

  loadAdmins(): void {
    this.isLoadingAdmins.set(true);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .get<GetAdminListRes>(`${this.constants.API_ENDPOINT}/admin/admins`, { headers })
      .pipe(catchError(() => of(null)))
      .subscribe(res => {
        if (res?.success) this.allAdmins.set(res.data.admins);
        this.isLoadingAdmins.set(false);
      });
  }

  setPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.currentPage.set(p);
    this.loadData();
  }

  pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1)
  );

  // ── Add Student Modal ────────────────────────────────────────────
  addStudentModal  = signal(false);
  isAddSaving      = signal(false);
  addSaveResult    = signal<{ ok: boolean; msg: string } | null>(null);
  addStudentForm: PostAddStudentReq = {
    role: 'Student', prefix: '', first_name: '', last_name: '',
    msu_mail: '', phone: '', degree_level: '', curriculum_year: '',
    study_plan_code: '', advisor_major_mail: '', advisor_co1_mail: '',
  };

  openAddStudentModal(): void {
    this.addStudentForm = {
      role: 'Student', prefix: '', first_name: '', last_name: '',
      msu_mail: '', phone: '', degree_level: '', curriculum_year: '',
      study_plan_code: '', advisor_major_mail: '', advisor_co1_mail: '',
    };
    this.addSaveResult.set(null);
    this.addStudentModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddStudentModal(): void {
    this.addStudentModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddStudent(): void {
    this.isAddSaving.set(true);
    this.addSaveResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const payload = { ...this.addStudentForm, advisor_major_mail: null, advisor_co1_mail: null };
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/single`,
        payload,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAddSaving.set(false);
        if (res?.success) {
          this.addSaveResult.set({ ok: true, msg: 'เพิ่มนิสิตเรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddStudentModal(); this.refreshAll(); }, 1500);
        } else {
          this.addSaveResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Add Advisor Modal ────────────────────────────────────────────
  addAdvisorModal  = signal(false);
  isAdvisorSaving  = signal(false);
  advisorSaveResult = signal<{ ok: boolean; msg: string } | null>(null);
  addAdvisorForm: PostAddAdvisorReq = {
    role: 'Supervisor', prefix: '', first_name: '', last_name: '', msu_mail: '', phone: '',
  };

  openAddAdvisorModal(): void {
    this.addAdvisorForm = {
      role: 'Supervisor', prefix: '', first_name: '', last_name: '', msu_mail: '', phone: '',
    };
    this.advisorSaveResult.set(null);
    this.addAdvisorModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddAdvisorModal(): void {
    this.addAdvisorModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddAdvisor(): void {
    this.isAdvisorSaving.set(true);
    this.advisorSaveResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const payload = {
      ...this.addAdvisorForm,
      degree_level: null, curriculum_year: null, study_plan_code: null,
      advisor_major_mail: null, advisor_co1_mail: null,
    };
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/single`,
        payload,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAdvisorSaving.set(false);
        if (res?.success) {
          this.advisorSaveResult.set({ ok: true, msg: 'เพิ่มอาจารย์เรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddAdvisorModal(); this.refreshAll(); }, 1500);
        } else {
          this.advisorSaveResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Assign Advisor Modal ─────────────────────────────────────────
  assignAdvisorModal   = signal<User | null>(null);
  isAssignSaving       = signal(false);
  assignAdvisorResult  = signal<{ ok: boolean; msg: string } | null>(null);
  assignAdvisorForm: PatchStudentAddAdvisorReq = {
    advisor_major_mail: '', advisor_co1_mail: '', advisor_co2_mail: '',
  };

  openAssignAdvisorModal(u: User): void {
    if (!this.allAdvisors().length) this.fetchAllByRole(Role.Supervisor, this.allAdvisors);
    this.assignAdvisorForm = {
      advisor_major_mail: u.advisors?.Major?.mail ?? '',
      advisor_co1_mail:   u.advisors?.Co_1?.mail  ?? '',
      advisor_co2_mail:   u.advisors?.Co_2?.mail  ?? '',
    };
    this.assignAdvisorResult.set(null);
    this.assignAdvisorModal.set(u);
    document.body.style.overflow = 'hidden';
  }

  closeAssignAdvisorModal(): void {
    this.assignAdvisorModal.set(null);
    document.body.style.overflow = '';
  }

  submitAssignAdvisor(): void {
    const u = this.assignAdvisorModal();
    if (!u) return;
    this.isAssignSaving.set(true);
    this.assignAdvisorResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}/advisors`,
        this.assignAdvisorForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAssignSaving.set(false);
        if (res?.success) {
          this.assignAdvisorResult.set({ ok: true, msg: 'กำหนดอาจารย์ที่ปรึกษาเรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAssignAdvisorModal(); this.loadData(); }, 1500);
        } else {
          this.assignAdvisorResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Import CSV Modal ─────────────────────────────────────────────
  importModal   = signal(false);
  isImporting   = signal(false);
  importResult  = signal<{ ok: boolean; msg: string } | null>(null);
  selectedFile: File | null = null;

  openImportModal(): void {
    this.selectedFile = null;
    this.importResult.set(null);
    this.importModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeImportModal(): void {
    this.importModal.set(false);
    document.body.style.overflow = '';
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.importResult.set(null);
  }

  submitImport(): void {
    if (!this.selectedFile) return;
    this.isImporting.set(true);
    this.importResult.set(null);

    const headers  = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    const formData = new FormData();
    formData.append('file', this.selectedFile);

    this.http
      .post<{ success: boolean; message?: string; data?: { imported?: number; failed?: number } }>(
        `${this.constants.API_ENDPOINT}/manage/users/import`,
        formData,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isImporting.set(false);
        if (res?.success) {
          const imported = res.data?.imported ?? 0;
          this.importResult.set({ ok: true, msg: `นำเข้าสำเร็จ ${imported} รายการ` });
          setTimeout(() => { this.closeImportModal(); this.refreshAll(); }, 2000);
        } else {
          this.importResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Suspend / Activate ───────────────────────────────────────────
  suspendingId  = signal<number | null>(null);
  suspendResult = signal<{ ok: boolean; msg: string } | null>(null);

  suspendUser(u: User): void {
    if (this.suspendingId() !== null) return;
    this.suspendingId.set(u.user_id);
    this.suspendResult.set(null);

    const isPending   = u.account_status === AccountStatus.Pending;
    const isSuspended = u.account_status === AccountStatus.Suspended;
    const endpoint    = isPending ? 'approve' : isSuspended ? 'activate' : 'suspend';
    const headers     = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });

    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}/${endpoint}`,
        {},
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.suspendingId.set(null);
        if (res?.success) {
          const msg = isPending ? `อนุมัติบัญชีเรียบร้อยแล้ว`
                    : isSuspended ? `เปิดใช้งานบัญชีเรียบร้อยแล้ว`
                    : `ระงับบัญชีเรียบร้อยแล้ว`;
          this.suspendResult.set({ ok: true, msg });
          this.loadData();
        } else {
          this.suspendResult.set({ ok: false, msg: `${failMsg(res)}` });
        }
        setTimeout(() => this.suspendResult.set(null), 3000);
      });
  }

  // ── Edit Modal ────────────────────────────────────────────────────
  editModal      = signal<User | null>(null);
  editForm: PatchManageUsersReq = {
    prefix: '', first_name: '', last_name: '', msu_mail: '',
    phone: '', degree_level: '', curriculum_year: '', study_plan_code: '',
  };
  isEditSaving   = signal(false);
  editSaveResult = signal<{ ok: boolean; msg: string } | null>(null);

  readonly prefixOptions          = ['นาย', 'นางสาว', 'นาง'];
  readonly advisorPrefixOptions   = ['ผศ.', 'ผศ.ดร.', 'รศ.', 'รศ.ดร.', 'ศ.', 'ศ.ดร.', 'ดร.', 'อ.'];
  readonly curriculumYearOptions  = ['2560', '2566'];

  readonly degreeLevelOptions = [
    { value: 'Master',   label: 'ป.โท (Master)' },
    { value: 'Doctoral', label: 'ป.เอก (Doctoral)' },
  ];

  readonly studyPlanOptions = [
    { group: 'Master',   values: ['Master_A1','Master_A2','Master_B','Master_P1A1','Master_P1A2','Master_P2B'] },
    { group: 'Doctoral', values: ['Doc_1_1','Doc_1_2','Doc_2_1','Doc_2_2','Doc_P1_1_1','Doc_P1_1_2','Doc_P2_2_1','Doc_P2_2_2'] },
  ];

  openEditModal(u: User): void {
    this.editForm = {
      prefix:          u.prefix          ?? '',
      first_name:      u.first_name      ?? '',
      last_name:       u.last_name       ?? '',
      msu_mail:        u.msu_mail        ?? '',
      phone:           u.phone           ?? '',
      degree_level:    u.degree_level    ?? '',
      curriculum_year: u.curriculum_year ?? '',
      study_plan_code: u.study_plan_code ?? '',
    };
    this.editSaveResult.set(null);
    this.editModal.set(u);
    document.body.style.overflow = 'hidden';
  }

  closeEditModal(): void {
    this.editModal.set(null);
    document.body.style.overflow = '';
  }

  submitEdit(): void {
    const u = this.editModal();
    if (!u) return;
    this.isEditSaving.set(true);
    this.editSaveResult.set(null);

    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/manage/users/${u.user_id}`,
        this.editForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isEditSaving.set(false);
        if (res?.success) {
          this.editSaveResult.set({ ok: true, msg: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
          // อัปเดต local list ทันที
          this.allUsers.update(users => users.map(x =>
            x.user_id === u.user_id
              ? { ...x,
                  prefix:          this.editForm.prefix          || null,
                  first_name:      this.editForm.first_name,
                  last_name:       this.editForm.last_name,
                  msu_mail:        this.editForm.msu_mail,
                  phone:           this.editForm.phone           || null,
                  degree_level:    (this.editForm.degree_level   || null) as DegreeLevel | null,
                  curriculum_year: this.editForm.curriculum_year || null,
                  study_plan_code: this.editForm.study_plan_code || null,
                }
              : x
          ));
          setTimeout(() => this.closeEditModal(), 1500);
        } else {
          this.editSaveResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Add Admin Modal (SuperAdmin only) ────────────────────────────
  addAdminModal    = signal(false);
  isAddAdminSaving = signal(false);
  addAdminResult   = signal<{ ok: boolean; msg: string } | null>(null);
  addAdminForm: PostAddAdminReq = { username: '', password: '', first_name: '', last_name: '', msu_mail: '' };

  openAddAdminModal(): void {
    this.addAdminForm = { username: '', password: '', first_name: '', last_name: '', msu_mail: '' };
    this.addAdminResult.set(null);
    this.addAdminModal.set(true);
    document.body.style.overflow = 'hidden';
  }

  closeAddAdminModal(): void {
    this.addAdminModal.set(false);
    document.body.style.overflow = '';
  }

  submitAddAdmin(): void {
    this.isAddAdminSaving.set(true);
    this.addAdminResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .post<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins`,
        this.addAdminForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isAddAdminSaving.set(false);
        if (res?.success) {
          this.addAdminResult.set({ ok: true, msg: 'เพิ่ม Admin เรียบร้อยแล้ว' });
          setTimeout(() => { this.closeAddAdminModal(); this.loadAdmins(); }, 1500);
        } else {
          this.addAdminResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Edit Admin Modal (SuperAdmin only) ───────────────────────────
  editAdminModal    = signal<Admin | null>(null);
  isEditAdminSaving = signal(false);
  editAdminResult   = signal<{ ok: boolean; msg: string } | null>(null);
  // ฟอร์มนี้แก้ชื่อ/นามสกุล/อีเมลเสมอ (ยังไม่ส่ง prefix เพราะ GET /admin/admins ไม่คืน prefix มา prefill — ส่งไปจะล้างค่าเดิม)
  editAdminForm: Required<Pick<PatchAdminReq, 'first_name' | 'last_name' | 'msu_mail'>> = { first_name: '', last_name: '', msu_mail: '' };

  openEditAdminModal(a: Admin): void {
    this.editAdminForm = { first_name: a.first_name, last_name: a.last_name, msu_mail: a.msu_mail };
    this.editAdminResult.set(null);
    this.editAdminModal.set(a);
    document.body.style.overflow = 'hidden';
  }

  closeEditAdminModal(): void {
    this.editAdminModal.set(null);
    document.body.style.overflow = '';
  }

  submitEditAdmin(): void {
    const a = this.editAdminModal();
    if (!a) return;
    this.isEditAdminSaving.set(true);
    this.editAdminResult.set(null);
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}`,
        this.editAdminForm,
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isEditAdminSaving.set(false);
        if (res?.success) {
          this.editAdminResult.set({ ok: true, msg: 'แก้ไขข้อมูลเรียบร้อยแล้ว' });
          this.allAdmins.update(list => list.map(x =>
            x.user_id === a.user_id
              ? { ...x, first_name: this.editAdminForm.first_name, last_name: this.editAdminForm.last_name, msu_mail: this.editAdminForm.msu_mail }
              : x
          ));
          setTimeout(() => this.closeEditAdminModal(), 1500);
        } else {
          this.editAdminResult.set({ ok: false, msg: failMsg(res) });
        }
      });
  }

  // ── Suspend / Activate Admin (SuperAdmin only) ───────────────────
  suspendingAdminId = signal<number | null>(null);

  // ── Delete Admin (SuperAdmin เท่านั้น) ─────────────────────────────
  deleteAdminTarget = signal<Admin | null>(null);
  isDeletingAdmin   = signal(false);
  deleteAdminError  = signal('');

  /** ห้ามลบ SuperAdmin และห้ามลบบัญชีตัวเอง */
  canDeleteAdmin(a: Admin): boolean {
    if (!this.isSuperAdmin || a.role === 'SuperAdmin') return false;
    const me = JSON.parse(localStorage.getItem('user') ?? 'null') as { userId?: number } | null;
    return me?.userId !== a.user_id;
  }

  openDeleteAdmin(a: Admin): void {
    this.deleteAdminError.set('');
    this.deleteAdminTarget.set(a);
    document.body.style.overflow = 'hidden';
  }

  closeDeleteAdmin(): void {
    if (this.isDeletingAdmin()) return;
    this.deleteAdminTarget.set(null);
    document.body.style.overflow = '';
  }

  confirmDeleteAdmin(): void {
    const a = this.deleteAdminTarget();
    if (!a || this.isDeletingAdmin()) return;
    this.isDeletingAdmin.set(true);
    this.deleteAdminError.set('');
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .delete<{ success: boolean; message?: string }>(`${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}`, { headers })
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.isDeletingAdmin.set(false);
        if (res?.success) {
          this.allAdmins.update(list => list.filter(x => x.user_id !== a.user_id));
          this.deleteAdminTarget.set(null);
          document.body.style.overflow = '';
          this.suspendResult.set({ ok: true, msg: `ลบบัญชี ${this.adminFullName(a)} เรียบร้อยแล้ว` });
          setTimeout(() => this.suspendResult.set(null), 3000);
        } else {
          this.deleteAdminError.set(failMsg(res, 'ลบบัญชีไม่สำเร็จ กรุณาลองใหม่'));
        }
      });
  }

  suspendAdmin(a: Admin): void {
    if (this.suspendingAdminId() !== null) return;
    this.suspendingAdminId.set(a.user_id);
    const isSuspended = a.account_status === 'Suspended';
    const endpoint    = isSuspended ? 'activate' : 'suspend';
    const headers     = new HttpHeaders({ Authorization: `Bearer ${this.auth.token}` });
    this.http
      .patch<{ success: boolean; message?: string }>(
        `${this.constants.API_ENDPOINT}/admin/admins/${a.user_id}/${endpoint}`,
        {},
        { headers }
      )
      .pipe(catchError(err => of(apiFailure(err))))
      .subscribe(res => {
        this.suspendingAdminId.set(null);
        if (res?.success) {
          const newStatus = isSuspended ? 'Active' : 'Suspended';
          this.allAdmins.update(list =>
            list.map(x => x.user_id === a.user_id ? { ...x, account_status: newStatus } : x)
          );
          this.suspendResult.set({
            ok: true,
            msg: isSuspended ? 'เปิดใช้งานบัญชีเรียบร้อยแล้ว' : 'ระงับบัญชีเรียบร้อยแล้ว',
          });
        } else {
          this.suspendResult.set({ ok: false, msg: `${failMsg(res)}` });
        }
        setTimeout(() => this.suspendResult.set(null), 3000);
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  adminFullName(a: Admin): string {
    return `${a.first_name} ${a.last_name}`.trim();
  }

  adminInitials(a: Admin): string {
    return ((a.first_name?.[0] ?? '') + (a.last_name?.[0] ?? '')).toUpperCase();
  }

  // ── Helpers ───────────────────────────────────────────────────────
  fullName(u: User): string {
    return `${u.prefix ? u.prefix + ' ' : ''}${u.first_name} ${u.last_name}`.trim();
  }

  initials(u: User): string {
    return ((u.first_name?.[0] ?? '') + (u.last_name?.[0] ?? '')).toUpperCase();
  }

  studentId(u: User): string {
    return u.msu_mail.replace('@msu.ac.th', '');
  }

  degreeLabel(d: DegreeLevel | null): string {
    if (d === DegreeLevel.Doctoral) return 'ป.เอก';
    if (d === DegreeLevel.Master)   return 'ป.โท';
    return '—';
  }

  majorAdvisorName(u: User): string {
    return u.advisors?.Major?.name ?? '—';
  }

  advisorStudentCount(u: User): number {
    const mail = u.msu_mail;
    return this.studentsForCount().filter(s =>
      s.advisors?.Major?.mail === mail || s.advisors?.Co_1?.mail === mail || s.advisors?.Co_2?.mail === mail
    ).length;
  }

  formatDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d as string).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }
}
