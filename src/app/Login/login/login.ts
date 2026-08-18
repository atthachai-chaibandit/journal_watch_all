import { Component, inject, signal, OnInit, NgZone } from '@angular/core';
import { GOOGLE_CLIENT_ID } from '../../auth-config';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Constants } from '../../comfig/constants';
import { Welcome } from '../../model/req/login_req';
import { LoginRes } from '../../model/res/login_res';
import { AuthService } from '../../auth.service';

declare const google: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    MatProgressSpinnerModule,
    MatSnackBarModule,
    RouterModule,
  ],
  templateUrl: './login.html',
  styleUrls: ['./login.scss'],
})
export class Login implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly constants = inject(Constants);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);

  loading = signal(false);

  readonly CLIENT_ID = GOOGLE_CLIENT_ID;

  ngOnInit() {
    this.loadGoogleScript().then(() => {
      google.accounts.id.initialize({
        client_id: this.CLIENT_ID,
        callback: (response: any) =>
          this.ngZone.run(() => this.handleGoogleCallback(response)),
      });

      google.accounts.id.renderButton(
        document.getElementById('google-btn'),
        {
          type: 'standard',
          shape: 'rectangular',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'th',
          width: 400,
        }
      );
    });
  }

  private decodeJwt(token: string): any {
    try {
      const payload = token.split('.')[1];
      const base64  = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4);
      return JSON.parse(atob(padded));
    } catch { return {}; }
  }

  private handleGoogleCallback(response: any) {
    this.loading.set(true);
    console.log(' idToken:', response.credential);
    const claims = this.decodeJwt(response.credential);
    const picture: string = claims['picture'] ?? '';
    console.log(' claims:', claims);
    console.log(' picture URL:', picture);
    const body: Welcome = { idToken: response.credential };

    this.http.post<LoginRes>(`${this.constants.API_ENDPOINT}/auth/google`, body).subscribe({
      next: (res: LoginRes) => {
        this.loading.set(false);
        this.authService.setLoggedIn(res, picture);
        this.showSnack(`ยินดีต้อนรับ ${res.data.user.firstName} ${res.data.user.lastName}`, 'success');
        const role = res.data.user.role?.toLowerCase();
        const target = role === 'supervisor' ? '/advisor/dashboard'
                     : role === 'staff'      ? '/staff/dashboard'
                     : '/dashboard';
        this.router.navigate([target]);
      },
      error: (err) => {
        this.loading.set(false);
        this.showSnack(err.error?.message || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
      
      },
    });
  }

  triggerGoogleSignIn(): void {
    const gsiBtn = document.querySelector('#google-btn div[role="button"]') as HTMLElement;
    gsiBtn?.click();
  }

  private loadGoogleScript(): Promise<void> {
    return new Promise((resolve) => {
      if (document.getElementById('google-gsi-script')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.id = 'google-gsi-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  private showSnack(message: string, type: 'success' | 'error' | 'info') {
    this.snackBar.open(message, '✕', {
      duration: 4000,
      panelClass: [`snack-${type}`],
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }
}
