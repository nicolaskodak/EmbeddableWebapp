# app/views.py
from django.shortcuts import render, redirect
from django.conf import settings
from django.contrib.auth import login, logout, authenticate
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from .forms import RegisterForm, LoginForm


@login_required
def home(request):
    iframe_src = None
    user_id = request.user.username

    # 仍需登入才可查看，但不再由 Django 自行產生 token。
    # APPSCRIPT_WEBAPP_URL 會是「完整可用的 URL」（包含 token 參數）。
    iframe_src = (settings.APPSCRIPT_WEBAPP_URL or "").strip() or None

    context = {
        "iframe_src": iframe_src,
        "user_id": user_id,
    }
    return render(request, "index.html", context)


def register_view(request):
    if request.user.is_authenticated:
        return redirect('home')
    
    if request.method == 'POST':
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            
            # 同步使用者到 Apps Script (Google Sheets)
            from .utils import sync_user_to_appscript
            sync_success = sync_user_to_appscript(user.username, user.email)
            
            if not sync_success:
                messages.warning(request, '註冊成功，但同步到 Google Sheets 失敗。請聯繫管理員。')
            
            login(request, user)
            messages.success(request, '註冊成功！')
            return redirect('home')
    else:
        form = RegisterForm()
    
    return render(request, 'register.html', {'form': form})


def login_view(request):
    if request.user.is_authenticated:
        return redirect('home')
    
    if request.method == 'POST':
        form = LoginForm(request, data=request.POST)
        if form.is_valid():
            username = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            user = authenticate(username=username, password=password)
            if user is not None:
                login(request, user)
                messages.success(request, f'歡迎回來，{username}！')
                return redirect('home')
    else:
        form = LoginForm()
    
    return render(request, 'login.html', {'form': form})


def logout_view(request):
    logout(request)
    messages.info(request, '您已登出。')
    return redirect('login')