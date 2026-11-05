from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Customer, Order


@receiver(post_save, sender=Order)
def link_customer(sender, instance: Order, **kwargs):
    """Every order with an email or phone is filed under a customer."""
    if instance.customer_id or not (instance.customer_email or instance.customer_phone):
        return
    c = Customer.for_contact(instance.customer_name, instance.customer_email, instance.customer_phone)
    if c:
        Order.objects.filter(pk=instance.pk).update(customer=c)
        instance.customer = c
