# app/forms.py
from django import forms
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth.models import User


class RegisterForm(UserCreationForm):
    email = forms.EmailField(required=True, label='電子郵件')
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password1', 'password2']
        labels = {
            'username': '使用者名稱',
        }
        
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['password1'].label = '密碼'
        self.fields['password2'].label = '確認密碼'


class LoginForm(AuthenticationForm):
    username = forms.CharField(label='使用者名稱')
    password = forms.CharField(label='密碼', widget=forms.PasswordInput)
